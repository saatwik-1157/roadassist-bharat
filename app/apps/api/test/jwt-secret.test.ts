/**
 * The JWT signing secret outside development.
 *
 * Every access token is an HS256 signature over JWT_SECRET, so whoever knows it
 * can mint an admin token. The development default is in the repository, and
 * the production guard only looked at NODE_ENV=production - the hosted demo
 * runs as NODE_ENV=demo and was never checked.
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEV_JWT_SECRET, MIN_JWT_SECRET_LENGTH, jwtSecretProblem } from "../src/domain/jwt-secret.js";

const LONG = "k".repeat(40);

describe("jwtSecretProblem", () => {
  it("accepts anything in development and tests, including the default", () => {
    for (const nodeEnv of ["development", "test", undefined]) {
      for (const raw of [undefined, "", DEV_JWT_SECRET, "short", LONG]) {
        assert.equal(jwtSecretProblem(nodeEnv, raw), null, `${nodeEnv} / ${raw}`);
      }
    }
  });

  for (const nodeEnv of ["demo", "staging", "production"]) {
    describe(`NODE_ENV=${nodeEnv}`, () => {
      it("refuses an unset or blank secret", () => {
        assert.match(jwtSecretProblem(nodeEnv, undefined) ?? "", /JWT_SECRET is unset/);
        assert.match(jwtSecretProblem(nodeEnv, "") ?? "", /JWT_SECRET is unset/);
        assert.match(jwtSecretProblem(nodeEnv, "   ") ?? "", /JWT_SECRET is unset/);
      });

      it("refuses the development default", () => {
        assert.match(jwtSecretProblem(nodeEnv, DEV_JWT_SECRET) ?? "", /development default/);
        assert.match(jwtSecretProblem(nodeEnv, "dev-only-" + "x".repeat(40)) ?? "", /development default/);
      });

      it(`refuses anything shorter than ${MIN_JWT_SECRET_LENGTH} characters`, () => {
        assert.match(jwtSecretProblem(nodeEnv, "x".repeat(MIN_JWT_SECRET_LENGTH - 1)) ?? "", /at least 32/);
        assert.equal(jwtSecretProblem(nodeEnv, "x".repeat(MIN_JWT_SECRET_LENGTH)), null);
      });

      it("accepts a long random secret", () => {
        assert.equal(jwtSecretProblem(nodeEnv, LONG), null);
      });
    });
  }

  it("never repeats the secret in its message", () => {
    const secret = "S3CR3T-" + "q".repeat(10);
    assert.ok(!(jwtSecretProblem("demo", secret) ?? "").includes(secret));
  });
});

/**
 * The wiring, not just the rule: validateEnv() in a fresh process, because env
 * is read once at import. JWT_SECRET is always passed explicitly (an empty
 * string counts as unset) so the developer's .env cannot fill it in.
 */
// Concurrent: each case is a cold tsx start of a few seconds.
describe("validateEnv", { concurrency: true }, () => {
  const ENV_TS = pathToFileURL(fileURLToPath(new URL("../src/env.ts", import.meta.url))).href;
  const boot = (vars: Record<string, string>) => {
    // DATABASE_URL is set explicitly too: outside development the env refuses
    // to boot without one, which would pass the refusal cases for the wrong
    // reason. Nothing connects to it - validateEnv() only reads it. CI's unit
    // job has no database, which is how a developer's own value hid this.
    const env: NodeJS.ProcessEnv = {
      ...process.env, SMS_PROVIDER: "console",
      DATABASE_URL: "postgres://localhost:5434/roadassist_env_test", ...vars,
    };
    delete env.CORS_ORIGINS; // unrelated problems would mask the one under test
    const r = spawnSync(process.execPath, [
      "--import", "tsx", "--input-type=module", "-e",
      `const m = await import(${JSON.stringify(ENV_TS)}); m.validateEnv(); console.log("BOOTED");`,
    ], { env, encoding: "utf8" });
    return { booted: r.status === 0 && r.stdout.includes("BOOTED"), out: r.stdout + r.stderr };
  };

  it("refuses to boot NODE_ENV=demo without a JWT_SECRET", () => {
    const r = boot({ NODE_ENV: "demo", JWT_SECRET: "" });
    assert.equal(r.booted, false);
    assert.match(r.out, /JWT_SECRET is unset/);
  });

  it("refuses to boot NODE_ENV=demo with the development default", () => {
    const r = boot({ NODE_ENV: "demo", JWT_SECRET: DEV_JWT_SECRET });
    assert.equal(r.booted, false);
    assert.match(r.out, /development default/);
  });

  it("refuses to boot NODE_ENV=demo with a short secret", () => {
    const r = boot({ NODE_ENV: "demo", JWT_SECRET: "too-short" });
    assert.equal(r.booted, false);
    assert.match(r.out, /at least 32/);
  });

  it("boots NODE_ENV=demo with a long secret", () => {
    const r = boot({ NODE_ENV: "demo", JWT_SECRET: LONG });
    assert.equal(r.booted, true, r.out);
  });

  it("still boots development with the default, as every suite does", () => {
    const r = boot({ NODE_ENV: "development", JWT_SECRET: "" });
    assert.equal(r.booted, true, r.out);
  });
});
