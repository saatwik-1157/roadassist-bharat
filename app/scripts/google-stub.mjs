/**
 * A local stand-in for Google's sign-in endpoints, for the e2e, security and
 * browser suites. Nothing in a test run ever reaches Google.
 *
 * The API under test must have been started with
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GOOGLE_ANDROID_CLIENT_ID
 *   GOOGLE_API_BASE=http://127.0.0.1:<port>
 * and the suite needs the same five in its own environment. The stub listens
 * on that port and serves the three things the API calls Google for:
 *
 *   GET  /o/oauth2/v2/auth    the consent screen, as a browser meets it: checks the
 *                             request like Google does (client, redirect URI, S256,
 *                             openid scope, state, nonce) and redirects straight back
 *                             with a code - as if the person chose an account
 *   POST /token               the code exchange: the code once, the client secret,
 *                             the same redirect URI, and the PKCE verifier that
 *                             hashes to the challenge - then an RS256 ID token
 *   GET  /oauth2/v3/certs     its public key as a JWKS (no-store: every suite run
 *                             makes a new key, and a cached old one would not verify)
 *
 * The suite chooses who "signs in" next (nextIdentity), can make the screen
 * answer "denied", and can mint tokens directly for the Android path - with
 * any claim wrong, or signed by a key Google never published.
 *
 * googleStub() returns { why } when the run is not set up for it - the suites
 * then skip their Google section and say so - and refuses a GOOGLE_API_BASE
 * that is not this machine.
 */
import { createServer } from "node:http";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";

export function googleStubEnv() {
  const e = process.env;
  const base = e.GOOGLE_API_BASE, clientId = e.GOOGLE_CLIENT_ID, secret = e.GOOGLE_CLIENT_SECRET;
  const redirectUri = e.GOOGLE_REDIRECT_URI, androidClientId = e.GOOGLE_ANDROID_CLIENT_ID;
  if (!base || !clientId || !secret || !redirectUri || !androidClientId) {
    return { why: "GOOGLE_API_BASE, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI and " +
      "GOOGLE_ANDROID_CLIENT_ID are not all set for this suite" };
  }
  let url;
  try { url = new URL(base); } catch { return { why: `GOOGLE_API_BASE=${base} is not a URL` }; }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.port) {
    return { why: `GOOGLE_API_BASE must be a local stub (http://127.0.0.1:<port>), not ${url.host}` };
  }
  return { port: Number(url.port), base: base.replace(/\/+$/, ""), clientId, secret, redirectUri, androidClientId };
}

const b64 = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
const s256 = (v) => createHash("sha256").update(v, "ascii").digest("base64url");

export async function googleStub() {
  const cfg = googleStubEnv();
  if (cfg.why) return { why: cfg.why };

  const key = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const rogue = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = "stub-" + randomBytes(6).toString("hex");
  const jwks = { keys: [{ ...key.publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" }] };

  const codes = new Map();      // code -> { identity, nonce, challenge, redirectUri, used }
  const stats = { authorize: 0, token: 0, tokenRefused: 0, jwks: 0 };
  let next = null;              // the identity the next consent screen "chooses"
  let deny = false;

  const now = () => Math.floor(Date.now() / 1000);
  const newSub = () => "1" + String(Math.floor(Math.random() * 1e15)).padStart(15, "0") + String(Math.floor(Math.random() * 1e4)).padStart(4, "0");

  /** An ID token. `over` replaces any claim (undefined deletes it); `rogue` signs with an unpublished key. */
  function mint(over = {}, o = {}) {
    const claims = {
      iss: "https://accounts.google.com", aud: cfg.clientId, azp: cfg.androidClientId,
      sub: newSub(), email: "someone@example.com", email_verified: true,
      iat: now(), exp: now() + 3600, ...over,
    };
    for (const [k, v] of Object.entries(claims)) if (v === undefined) delete claims[k];
    const head = b64(o.header ?? { alg: "RS256", kid, typ: "JWT" });
    const body = b64(claims);
    const sig = sign("RSA-SHA256", Buffer.from(`${head}.${body}`), o.rogue ? rogue.privateKey : key.privateKey).toString("base64url");
    return `${head}.${body}.${sig}`;
  }

  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const url = new URL(req.url, cfg.base);
      const json = (status, body, headers = {}) => {
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(JSON.stringify(body));
      };
      if (req.method === "GET" && url.pathname === "/oauth2/v3/certs") {
        stats.jwks++;
        return json(200, jwks, { "cache-control": "no-store" });
      }
      if (req.method === "GET" && url.pathname === "/o/oauth2/v2/auth") {
        stats.authorize++;
        const q = url.searchParams;
        const problem =
          q.get("client_id") !== cfg.clientId ? "invalid_client" :
          q.get("redirect_uri") !== cfg.redirectUri ? "redirect_uri_mismatch" :
          q.get("response_type") !== "code" ? "unsupported_response_type" :
          q.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(q.get("code_challenge") ?? "") ? "invalid_request (PKCE S256)" :
          !(q.get("scope") ?? "").split(" ").includes("openid") ? "invalid_scope" :
          !q.get("state") || !q.get("nonce") ? "invalid_request (state and nonce)" : null;
        if (problem) {
          res.writeHead(400, { "content-type": "text/plain" });
          return res.end(`stub consent screen refused: ${problem}`);
        }
        const back = new URL(cfg.redirectUri);
        back.searchParams.set("state", q.get("state"));
        if (deny) {
          deny = false;
          back.searchParams.set("error", "access_denied");
        } else {
          const identity = { sub: newSub(), email: "someone@example.com", email_verified: true, ...(next ?? {}) };
          next = null;
          const code = "4/0Stub" + randomBytes(24).toString("base64url");
          codes.set(code, { identity, nonce: q.get("nonce"), challenge: q.get("code_challenge"), redirectUri: q.get("redirect_uri"), used: false });
          back.searchParams.set("code", code);
        }
        res.writeHead(302, { location: back.toString() });
        return res.end();
      }
      if (req.method === "POST" && url.pathname === "/token") {
        stats.token++;
        const f = new URLSearchParams(raw);
        const grant = codes.get(f.get("code") ?? "");
        const refuse = (error) => { stats.tokenRefused++; return json(400, { error }); };
        if (f.get("grant_type") !== "authorization_code") return refuse("unsupported_grant_type");
        if (f.get("client_id") !== cfg.clientId || f.get("client_secret") !== cfg.secret) return refuse("invalid_client");
        if (!grant || grant.used) return refuse("invalid_grant");
        grant.used = true;   // Google: a code works once
        if (f.get("redirect_uri") !== grant.redirectUri) return refuse("invalid_grant");
        if (!f.get("code_verifier") || s256(f.get("code_verifier")) !== grant.challenge) return refuse("invalid_grant");
        const { sub, email, email_verified, ...rest } = grant.identity;
        return json(200, {
          access_token: "ya29.stub-" + randomBytes(8).toString("hex"), token_type: "Bearer", expires_in: 3599,
          scope: "openid https://www.googleapis.com/auth/userinfo.email",
          id_token: mint({ aud: cfg.clientId, azp: cfg.clientId, nonce: grant.nonce, sub, email, email_verified, ...rest }),
        });
      }
      return json(404, { error: "not_found" });
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(cfg.port, "127.0.0.1", resolve);
  });

  return {
    ...cfg,
    stats,
    mint,
    newSub,
    /** Who the next consent screen signs in as: { sub, email, email_verified, ...any claim }. */
    nextIdentity: (identity) => { next = identity; },
    /** The next consent screen answers "access denied". */
    denyNext: () => { deny = true; },
    close: () => new Promise((r) => server.close(() => r())),
  };
}

/**
 * A browser, as far as the web flow needs one: follows the API's redirects by
 * hand (so each hop can be inspected) and keeps cookies per host.
 */
export function cookieJar() {
  const jar = new Map();   // host -> Map(name -> value)
  return {
    jar,
    store(url, res) {
      const host = new URL(url).host;
      const m = jar.get(host) ?? new Map();
      for (const line of res.headers.getSetCookie?.() ?? []) {
        const [pair, ...attrs] = line.split(";");
        const i = pair.indexOf("=");
        const name = pair.slice(0, i).trim(), value = pair.slice(i + 1).trim();
        const cleared = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === "";
        if (cleared) m.delete(name); else m.set(name, value);
      }
      jar.set(host, m);
    },
    header(url) {
      const m = jar.get(new URL(url).host);
      return m && m.size ? [...m].map(([k, v]) => `${k}=${v}`).join("; ") : undefined;
    },
    get(url, name) { return jar.get(new URL(url).host)?.get(name); },
    set(url, name, value) {
      const host = new URL(url).host;
      const m = jar.get(host) ?? new Map();
      if (value === undefined) m.delete(name); else m.set(name, value);
      jar.set(host, m);
    },
  };
}

/**
 * GET `url` with the jar, without following redirects. Returns the response,
 * its Location (absolute) and the Set-Cookie lines.
 */
export async function hop(jar, url, init = {}) {
  const cookie = jar.header(url);
  const res = await fetch(url, {
    redirect: "manual", ...init,
    headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) },
  });
  jar.store(url, res);
  const loc = res.headers.get("location");
  return { res, status: res.status, location: loc ? new URL(loc, url).toString() : null, setCookies: res.headers.getSetCookie?.() ?? [] };
}

/**
 * Press "Continue with Google" in a pretend browser: start -> stub consent ->
 * callback. Returns every hop, and where the app page was sent.
 */
export async function webGoogleFlow(base, jar, { link = false } = {}) {
  const start = await hop(jar, `${base}/v1/auth/google/start${link ? "?link=1" : ""}`);
  if (start.status !== 302 || !start.location) return { start };
  if (start.location.startsWith(`${base}/app.html`)) return { start, landed: new URL(start.location) };
  const consent = await hop(jar, start.location);
  if (consent.status !== 302 || !consent.location) return { start, consent };
  const callback = await hop(jar, consent.location);
  return { start, consent, callback, landed: callback.location ? new URL(callback.location) : null };
}
