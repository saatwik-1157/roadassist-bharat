/**
 * Put the running app on a public HTTPS URL, for real phones.
 *
 * A phone browser withholds three things over plain HTTP: geolocation, service
 * worker registration, and "Add to home screen". All three are core to this
 * product, so a phone on the same WiFi hitting http://<lan-ip>:4000 gets a
 * degraded app that cannot find you, cannot work offline, and cannot install.
 * A TLS-terminating tunnel is the cheapest way to give a demo the real thing.
 *
 * Uses Cloudflare's quick tunnels: no account, no config, no cost. The URL is
 * random and lives only as long as this process.
 *
 *   npm run share
 *
 * Set TRUST_PROXY=true in .env before using this (it already is), or every
 * visitor shares one apparent IP and the per-IP OTP ceiling becomes a single
 * bucket the whole room exhausts between them.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

const PORT = Number(process.env.PORT ?? 4000);
const LOCAL = `http://localhost:${PORT}`;

const CLOUDFLARED = [
  "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
  "C:\\Program Files\\cloudflared\\cloudflared.exe",
  `${process.env.LOCALAPPDATA}\\Microsoft\\WinGet\\Links\\cloudflared.exe`,
  "/usr/local/bin/cloudflared",
  "/usr/bin/cloudflared",
  "/opt/homebrew/bin/cloudflared",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bold = (s) => `\u001b[1m${s}\u001b[0m`;
const dim = (s) => `\u001b[2m${s}\u001b[0m`;
const gold = (s) => `\u001b[38;5;179m${s}\u001b[0m`;

function findCloudflared() {
  const hit = CLOUDFLARED.find((p) => existsSync(p));
  if (hit) return hit;
  // Fall back to PATH.
  const which = spawnSync(process.platform === "win32" ? "where" : "which",
    ["cloudflared"], { encoding: "utf8" });
  const line = (which.stdout ?? "").split(/\r?\n/).find(Boolean);
  return line || null;
}

async function serverIsUp() {
  try {
    const res = await fetch(`${LOCAL}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch { return false; }
}

const exe = findCloudflared();
if (!exe) {
  console.error(`
${bold("cloudflared is not installed.")}

  Windows   winget install --id Cloudflare.cloudflared
  macOS     brew install cloudflared
  Linux     https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

It needs no account and costs nothing.
`);
  process.exit(1);
}

if (!(await serverIsUp())) {
  console.error(`
${bold(`Nothing is answering on ${LOCAL}.`)}

Start the API first, in another terminal:

  npm start

If the database is not up yet:

  npm run infra:up
  npm run db:reset && npm run db:migrate && npm run db:seed && npm run db:seed:raksha
`);
  process.exit(1);
}

console.log(dim("Opening a public HTTPS tunnel to " + LOCAL + " …\n"));

const proc = spawn(exe, ["tunnel", "--url", LOCAL, "--no-autoupdate"], {
  stdio: ["ignore", "pipe", "pipe"],
});

let url = null;
let announced = false;

function announce(u) {
  if (announced) return;
  announced = true;
  writeFileSync(new URL("../.share-url", import.meta.url), u + "\n");
  const line = "─".repeat(Math.max(52, u.length + 4));
  console.log(`
${gold(line)}
  ${bold("RoadAssist is live at")}

  ${bold(gold(u))}

  ${dim("Open that on any phone, on any network.")}
${gold(line)}

  ${bold("Customer")}    ${u}/app.html
                 sign in with any Indian mobile — 10 digits is fine
  ${bold("Mechanic")}    ${u}/mechanic.html
                 use the number shown on the customer's "Call mechanic" button
  ${bold("Authority")}   ${u}/raksha.html
                 +919999900001

  ${bold("On the phone:")} open the customer link, then use the browser menu →
  ${dim("\"Add to Home screen\" / \"Install app\".")} It then opens fullscreen, works
  ${dim("offline, and can use GPS — none of which is possible over plain HTTP.")}

  ${bold("\u26a0 The OTP is auto-filled for anyone who opens this link.")}
  ${dim("EXPOSE_DEV_OTP=true means the code comes back in the response, so anyone")}
  ${dim("with the URL can sign in as any number. Fine for a demo among people you")}
  ${dim("chose to send it to; do not post the link publicly. To require a shared")}
  ${dim("passcode instead, set EXPOSE_DEV_OTP=false and DEV_OTP=<six digits> in")}
  ${dim(".env, restart, and tell your testers the code.")}

  ${dim("The URL dies when you stop this process (Ctrl+C). A new run gets a new one.")}
`);
}

const scan = (chunk) => {
  const text = chunk.toString();
  const found = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (found && !url) { url = found[0]; announce(url); }
  // Cloudflare prints its banner and connection log to stderr; keep only the
  // parts a person would act on.
  if (/ERR|error|failed/i.test(text) && !/Thank you for trying/i.test(text)) {
    process.stderr.write(dim(text));
  }
};
proc.stdout.on("data", scan);
proc.stderr.on("data", scan);

const stop = () => { try { proc.kill(); } catch { /* already gone */ } process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
proc.on("exit", (code) => {
  if (!announced) console.error(`cloudflared exited (${code}) before publishing a URL.`);
  process.exit(code ?? 0);
});

// A quick tunnel usually publishes within a couple of seconds.
await sleep(45000);
if (!url) {
  console.error("No tunnel URL after 45s — check your network and try again.");
  stop();
}
