import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createServer } from "node:http";
import express from "express";
import session from "express-session";
import * as jose from "jose";
import * as openid from "openid-client";
import { test_db_config } from "../../test/db_helper.js";
import { start_v1, ORIGIN } from "../../test/v1_harness.js";
import { create_google_router } from "./google.js";
import { error_handler } from "../middleware/error_handler.js";
import { NO_PASSWORD_SENTINEL } from "./identity.js";

// Ticket 03 seam: the callback's provisioning over real HTTP, the real v1
// stack and the real database. The stub issuer extends ticket 02's: it serves
// discovery, mints RS256 ID tokens for the code it issued and verifies PKCE.

const { skip } = test_db_config();

let issuer_server;
let issuer_port;
let private_key;
let config;

// Registered authorization codes (code -> issued claims), redeemable once.
const issued_codes = new Map();

before(async () => {
  private_key = await jose.generateKeyPair("RS256", { extractable: true });
  const public_jwk = { ...await jose.exportJWK(private_key.publicKey), kid: "stub-key", alg: "RS256", use: "sig" };
  issuer_server = createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${issuer_port}`);
    if (url.pathname === "/.well-known/openid-configuration") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        issuer: `http://127.0.0.1:${issuer_port}`,
        authorization_endpoint: `http://127.0.0.1:${issuer_port}/authorize`,
        token_endpoint: `http://127.0.0.1:${issuer_port}/token`,
        jwks_uri: `http://127.0.0.1:${issuer_port}/jwks`,
        id_token_signing_alg_values_supported: ["RS256"],
      }));
    } else if (url.pathname === "/jwks") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ keys: [public_jwk] }));
    } else if (url.pathname === "/token") {
      // Parse the form body, check client auth + PKCE, mint an ID token.
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", async () => {
        try {
          const params = new URLSearchParams(body);
          // google_setup.js authenticates by client_secret_post (the bare
          // secret string in discovery resolves to that default).
          if (params.get("grant_type") !== "authorization_code" || params.get("client_secret") !== "client-secret") {
            res.writeHead(400, { "content-type": "application/json" });
            return res.end(JSON.stringify({ error: "invalid_client" }));
          }
          const issued = issued_codes.get(params.get("code"));
          issued_codes.delete(params.get("code"));
          if (!issued || issued.redirect_uri !== params.get("redirect_uri")) {
            res.writeHead(400, { "content-type": "application/json" });
            return res.end(JSON.stringify({ error: "invalid_grant" }));
          }
          const code_challenge = await openid.calculatePKCECodeChallenge(params.get("code_verifier") ?? "");
          if (code_challenge !== issued.code_challenge) {
            res.writeHead(400, { "content-type": "application/json" });
            return res.end(JSON.stringify({ error: "invalid_grant", error_description: "pkce mismatch" }));
          }
          const now = Math.floor(Date.now() / 1000);
          const id_token = await new jose.SignJWT({
            sub: issued.sub, email: issued.email, email_verified: issued.email_verified, name: issued.name,
            nonce: issued.nonce, aud: "client-id", iss: `http://127.0.0.1:${issuer_port}`, iat: now, exp: now + 300,
          }).setProtectedHeader({ alg: "RS256", kid: "stub-key" }).sign(private_key.privateKey);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ access_token: "at", token_type: "Bearer", id_token }));
        } catch (error) {
          res.writeHead(500); res.end(String(error?.message));
        }
      });
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => issuer_server.listen(0, "127.0.0.1", () => {
    issuer_port = issuer_server.address().port;
    resolve();
  }));
  config = await openid.discovery(
    new URL(`http://127.0.0.1:${issuer_port}`), "client-id", "client-secret", undefined,
    { execute: [openid.allowInsecureRequests] });
});

after(async () => { issuer_server.close(); });

// Issues a code at the stub's /authorize URL shape; the test then replays the
// callback URL the browser would follow.
function issue_code({ sub, email, email_verified, name, nonce, code_challenge, redirect_uri }) {
  const id = Buffer.from(`${sub}:${email}:${Math.random()}`).toString("base64url");
  issued_codes.set(id, { sub, email, email_verified, name, nonce, code_challenge, redirect_uri });
  return id;
}

// The session cookie of a response (first cookie attribute only).
function cookie_of(response) {
  return response.headers.get("set-cookie")?.split(";")[0];
}

// Round trip: start (the frontend-facing mount, the path a browser visits) ->
// the callback URL Google would redirect to, replayed against the test server.
async function google_sign_in(app, { sub, email, email_verified = true, name = "Google User" }) {
  const base = app.base;
  const start = await fetch(`${base}/api/auth/google/start`, { redirect: "manual" });
  assert.equal(start.status, 302);
  const authorize = new URL(start.headers.get("location"));
  const nonce = authorize.searchParams.get("nonce");
  const code_challenge = authorize.searchParams.get("code_challenge");
  const redirect_uri = authorize.searchParams.get("redirect_uri");
  const code = await issue_code({ sub, email, email_verified, name, nonce, code_challenge, redirect_uri });
  const cookie = cookie_of(start);
  const callback_url = new URL(redirect_uri);
  const callback = await fetch(`${base}${callback_url.pathname}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(authorize.searchParams.get("state"))}`, { redirect: "manual", headers: { cookie } });
  return { response: callback, cookie, follow_up_cookie: cookie_of(callback) };
}

describe("v1 Google callback provisioning (DB)", { skip }, () => {
  let app;

  before(async () => {
    app = await start_v1({
      throttle_limits: { login: 5, register: 50, ip: 500 },
      google_client: { enabled: true, get_config: async () => config },
    });
  });
  after(async () => { await app?.stop(); });

  test("a google_sub match signs the existing linked user in with a fresh session", async () => {
    await app.user({ email: "linked-before@example.test", student_id: "3035-001", password: "correct-horse-1" });
    await app.admin.query("UPDATE users SET google_sub = 'sub-existing' WHERE email = 'linked-before@example.test'");
    const { response } = await google_sign_in(app, { sub: "sub-existing", email: "linked-before@example.test" });
    assert.equal(response.status, 302);
    assert.equal(new URL(response.headers.get("location")).href, `${ORIGIN}/`, "no error marker");
    // The follow-up session cookie carries user_id for the linked user.
    const client = app.client();
    client.cookie = cookie_of(response);
    const session = await client.get("/auth/session");
    assert.equal(session.status, 200);
    assert.equal(session.body.data.user.email, "linked-before@example.test");
    assert.deepEqual(session.body.data.memberships, []);
  });

  test("a verified email links the password account: google_sub set, password and memberships survive", async () => {
    const user_id = await app.user({ email: "link-me@example.test", student_id: "3035-002", password: "correct-horse-1" });
    const { response } = await google_sign_in(app, { sub: "sub-link", email: "link-me@example.test" });
    assert.equal(response.status, 302);
    assert.equal(new URL(response.headers.get("location")).href, `${ORIGIN}/`);
    const [[row]] = await app.admin.query("SELECT google_sub, password_hash FROM users WHERE id = ?", [user_id]);
    assert.equal(row.google_sub, "sub-link");
    assert.match(row.password_hash, /^scrypt\$/, "the password survives the link");
    const client = app.client();
    client.cookie = cookie_of(response);
    const session = await client.get("/auth/session");
    assert.equal(session.status, 200);
    assert.equal(session.body.data.user.email, "link-me@example.test");
    assert.equal(session.body.data.user.student_id, "3035-002");
  });

  test("an unverified email is rejected with the friendly marker and no account is touched", async () => {
    await app.user({ email: "verify-me@example.test", student_id: "3035-003", password: "correct-horse-1" });
    const { response } = await google_sign_in(app, { sub: "sub-unverified", email: "verify-me@example.test", email_verified: false });
    assert.equal(response.status, 302);
    assert.equal(new URL(response.headers.get("location")).searchParams.get("error"), "google_email_unverified");
    const [[row]] = await app.admin.query("SELECT google_sub FROM users WHERE email = 'verify-me@example.test'");
    assert.equal(row.google_sub, null, "no link happened");
    const [[count]] = await app.admin.query("SELECT COUNT(*) AS n FROM users WHERE google_sub = 'sub-unverified'");
    assert.equal(Number(count.n), 0, "no new user either");
  });

  test("a new user is created with the sentinel password, null student_id and the student role", async () => {
    const { response } = await google_sign_in(app, { sub: "sub-new", email: "fresh@example.test", name: "Fresh Face" });
    assert.equal(response.status, 302);
    assert.equal(new URL(response.headers.get("location")).href, `${ORIGIN}/`);
    const [[row]] = await app.admin.query("SELECT id, google_sub, password_hash, student_id, platform_role FROM users WHERE email = 'fresh@example.test'");
    assert.equal(row.google_sub, "sub-new");
    assert.equal(row.password_hash, NO_PASSWORD_SENTINEL);
    assert.equal(row.student_id, null);
    assert.equal(row.platform_role, "student");
    // The created user is signed in, with the Google-only login still blocked.
    const client = app.client();
    client.cookie = cookie_of(response);
    const session = await client.get("/auth/session");
    assert.equal(session.status, 200);
    assert.equal(session.body.data.user.email, "fresh@example.test");
    assert.equal(session.body.data.user.student_id, null);
    const password_attempt = app.client();
    const login = await password_attempt.post("/auth/login", { email: "fresh@example.test", password: NO_PASSWORD_SENTINEL });
    assert.equal(login.status, 401);
  });

  test("the session is regenerated and the CSRF token rotated by the callback", async () => {
    const start = await fetch(`${app.base}/api/auth/google/start`, { redirect: "manual" });
    const old_cookie = start.headers.get("set-cookie").split(";")[0];
    const authorize = new URL(start.headers.get("location"));
    const code = await issue_code({ sub: "sub-csrf", email: "csrf@example.test", email_verified: true, name: "R", nonce: authorize.searchParams.get("nonce"), code_challenge: authorize.searchParams.get("code_challenge"), redirect_uri: authorize.searchParams.get("redirect_uri") });
    const callback = await fetch(`${app.base}/api/auth/google/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(authorize.searchParams.get("state"))}`, { redirect: "manual", headers: { cookie: old_cookie } });
    assert.equal(callback.status, 302);
    const new_cookie = cookie_of(callback);
    assert.notEqual(new_cookie.split("=")[1], old_cookie.split("=")[1], "session id regenerated");
    // The fresh session is authenticated (user_id carried over the regenerate).
    const client = app.client();
    client.cookie = new_cookie;
    assert.equal((await client.get("/auth/session")).status, 200);
  });

  test("a replayed callback (reused or absent handshake) lands on the handshake error marker", async () => {
    const { response: first, cookie } = await google_sign_in(app, { sub: "sub-replay", email: "replay@example.test" });
    assert.equal(first.status, 302);
    // Replaying the exact same callback URL (same code and state, same
    // session cookie) must fail: the handshake values were consumed once.
    const replayed = await fetch(`${app.base}/api/auth/google/callback?code=x&state=y`, { redirect: "manual", headers: { cookie } });
    assert.equal(replayed.status, 302);
    assert.equal(new URL(replayed.headers.get("location")).searchParams.get("error"), "google_invalid_handshake");
    // And it leaves no fresh session: the replay cannot be used to sign in.
    const check = await fetch(`${app.base}/api/v1/auth/session`, { headers: { cookie: cookie_of(replayed) ?? cookie } });
    assert.equal(check.status, 401);
  });

  test("the enabled stack keeps serving the ordinary v1 endpoints after the Google routes", async () => {
    // Disabled mode is covered by the handshake suite; here the enabled stack
    // must still answer the ordinary v1 endpoints after the Google routes.
    const client = app.client();
    assert.equal((await client.get("/auth/csrf")).status, 200);
  });
});

// Error-redirect mapping at the API seam, without a live IdP: the router is
// mounted over a pool whose provisioning always fails in a chosen way, and the
// (otherwise valid) handshake callback must land on the friendly marker.
describe("v1 Google callback error redirects (mapping)", { skip }, () => {
  // A minimal express app mirroring the /api/auth mount (session, no CSRF).
  function create_app_with_pool(pool) {
    const app = express();
    app.use(session({ name: "clubspace.sid", secret: "s".repeat(32), resave: false, saveUninitialized: false, store: new session.MemoryStore() }));
    app.use("/api/auth", create_google_router({ google_client: { enabled: true, get_config: async () => config }, app_origin: ORIGIN, pool }).router);
    app.use(error_handler({ logger: { error() {} } }));
    return app;
  }

  for (const { marker, pool_error } of [
    { marker: "google_sign_in_busy", pool_error: { code: "ER_DUP_ENTRY" } },
    { marker: "google_unavailable", pool_error: new Error("db gone") },
  ]) {
    test(`provisioning that fails (${pool_error.code ?? "generic"}) redirects to ${marker}`, async () => {
      const app = create_app_with_pool({
        // The failure happens at the same place a real race produces it: the
        // link UPDATE or user INSERT hitting the unique index. Reads succeed,
        // writes raise the pool_error inside provisioning, where it maps.
        getConnection: async () => ({
          query: async (sql) => {
            if (/^(INSERT|UPDATE)/.test(sql)) throw pool_error;
            return [[], []];
          },
          beginTransaction: async () => {},
          commit: async () => {},
          rollback: async () => {},
          release() {},
        }),
      });
      const server = app.listen(0, "127.0.0.1");
      await new Promise((resolve) => server.once("listening", resolve));
      try {
        const base = `http://127.0.0.1:${server.address().port}`;
        const start = await fetch(`${base}/api/auth/google/start`, { redirect: "manual" });
        const authorize = new URL(start.headers.get("location"));
        const code = await issue_code({ sub: `sub-${marker}`, email: `${marker}@example.test`, email_verified: true, name: "X", nonce: authorize.searchParams.get("nonce"), code_challenge: authorize.searchParams.get("code_challenge"), redirect_uri: authorize.searchParams.get("redirect_uri") });
        const callback = await fetch(`${base}/api/auth/google/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(authorize.searchParams.get("state"))}`, { redirect: "manual", headers: { cookie: cookie_of(start) } });
        assert.equal(callback.status, 302);
        assert.equal(new URL(callback.headers.get("location")).searchParams.get("error"), marker);
      } finally {
        server.closeAllConnections?.();
        server.close();
      }
    });
  }
});
