import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import express from "express";
import session from "express-session";
import { createServer } from "node:http";
import * as openid from "openid-client";
import { create_google_router } from "./google.js";
import { error_handler } from "../middleware/error_handler.js";

// Ticket 02 seam A: the Google router's public interface over real HTTP,
// through the app's real error handler (so a wrong error shape fails here,
// not in production). The issuer is a local HTTPS-less stub — discovery
// requires HTTPS unless allowInsecureRequests is set, which is fine for tests
// against localhost. The stub port is allocated at runtime, not hardcoded.

const CALLBACK_ORIGIN = "http://localhost:5173";

let issuer_server;
let issuer_port;
let config;

before(async () => {
  issuer_server = createServer((req, res) => {
    if (req.url === "/.well-known/openid-configuration") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        issuer: `http://127.0.0.1:${issuer_port}`,
        authorization_endpoint: `http://127.0.0.1:${issuer_port}/authorize`,
        token_endpoint: `http://127.0.0.1:${issuer_port}/token`,
        jwks_uri: `http://127.0.0.1:${issuer_port}/jwks`,
        id_token_signing_alg_values_supported: ["RS256"],
      }));
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

// A minimal session-aware app mounting the real error handler: the OAuth
// routes are GETs and need the session (handshake state lives there) but no
// CSRF/origin check. The pool rejects any query: ticket 02's tests only cover
// the handshake, and a provisioning attempt lands in the catch-all error
// redirect instead.
function create_test_app({ google_client, app_origin = CALLBACK_ORIGIN, ip_throttle } = {}) {
  const store = new session.MemoryStore();
  const app = express();
  app.use(session({ name: "clubspace.sid", secret: "s".repeat(32), resave: false, saveUninitialized: false, store }));
  app._session_store_for_test = store;
  app.use("/api/auth", create_google_router({ google_client, app_origin, ip_throttle, pool: rejecting_pool() }).router);
  app.use(error_handler({ logger: { error() {} } }));
  return app;
}

function rejecting_pool() {
  return { query: async () => { throw new Error("no database in handshake tests"); }, getConnection: async () => { throw new Error("no database in handshake tests"); } };
}

// The google_client object google_setup.js produces, wired to the stub issuer.
function stub_google_client() {
  return { enabled: true, get_config: async () => config };
}

// Listens and resolves only once the server is actually bound.
function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  return new Promise((resolve) => server.once("listening", () => resolve({ base: `http://127.0.0.1:${server.address().port}`, server })));
}

// Reads the session's handshake values straight from the store.
async function stored_session(app, cookie) {
  const session_id = decodeURIComponent(cookie.split("=")[1]).slice(2).split(".")[0];
  return new Promise((resolve, reject) => app._session_store_for_test.get(session_id, (error, result) => (error ? reject(error) : resolve(result))));
}

describe("v1 Google OIDC routes (handshake only)", () => {
  test("start redirects to the IdP authorization endpoint with state, nonce and PKCE in the session", async () => {
    const app = create_test_app({ google_client: stub_google_client() });
    const { base, server } = await listen(app);
    try {
      const response = await fetch(`${base}/api/auth/google/start`, { redirect: "manual" });
      assert.equal(response.status, 302);
      const target = new URL(response.headers.get("location"));
      assert.equal(target.origin + target.pathname, `http://127.0.0.1:${issuer_port}/authorize`);
      assert.equal(target.searchParams.get("client_id"), "client-id");
      assert.equal(target.searchParams.get("redirect_uri"), `${CALLBACK_ORIGIN}/api/auth/google/callback`);
      assert.equal(target.searchParams.get("scope"), "openid email profile");
      assert.equal(target.searchParams.get("response_type"), "code");
      assert.ok(target.searchParams.get("state"), "state present");
      assert.ok(target.searchParams.get("nonce"), "nonce present");
      assert.equal(target.searchParams.get("code_challenge_method"), "S256");
      assert.ok(target.searchParams.get("code_challenge"), "PKCE challenge present");
      // The handshake values are session-scoped.
      const cookie = response.headers.get("set-cookie").split(";")[0];
      const stored = await stored_session(app, cookie);
      assert.equal(stored.google_state, target.searchParams.get("state"));
      assert.equal(stored.google_nonce, target.searchParams.get("nonce"));
      assert.ok(stored.google_code_verifier, "verifier stored");
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });

  test("callback with a mismatched state on a real session redirects with the error marker", async () => {
    const app = create_test_app({ google_client: stub_google_client() });
    const { base, server } = await listen(app);
    try {
      // A real session with handshake values, then an attacker-forged callback.
      const start = await fetch(`${base}/api/auth/google/start`, { redirect: "manual" });
      const cookie = start.headers.get("set-cookie").split(";")[0];
      const forged = await fetch(`${base}/api/auth/google/callback?state=forged&code=abc`, { redirect: "manual", headers: { cookie } });
      assert.equal(forged.status, 302);
      const target = new URL(forged.headers.get("location"));
      assert.equal(target.href, `${CALLBACK_ORIGIN}/?error=google_invalid_handshake`);
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });

  test("callback with no session at all redirects with the error marker too", async () => {
    const app = create_test_app({ google_client: stub_google_client() });
    const { base, server } = await listen(app);
    try {
      const forged = await fetch(`${base}/api/auth/google/callback?state=forged&code=abc`, { redirect: "manual" });
      assert.equal(forged.status, 302);
      assert.equal(new URL(forged.headers.get("location")).href, `${CALLBACK_ORIGIN}/?error=google_invalid_handshake`);
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });

  test("callback with the matching state validates, clears the handshake and fails friendly when the exchange cannot complete", async () => {
    const app = create_test_app({ google_client: stub_google_client() });
    const { base, server } = await listen(app);
    try {
      const start = await fetch(`${base}/api/auth/google/start`, { redirect: "manual" });
      const state = new URL(start.headers.get("location")).searchParams.get("state");
      const cookie = start.headers.get("set-cookie").split(";")[0];
      const callback = await fetch(`${base}/api/auth/google/callback?state=${encodeURIComponent(state)}&code=abc`, { redirect: "manual", headers: { cookie } });
      assert.equal(callback.status, 302);
      const target = new URL(callback.headers.get("location"));
      // The stub issuer has no token endpoint, so the grant fails; the user
      // sees the friendly unavailable marker, not a 500 or a stack.
      assert.equal(target.href, `${CALLBACK_ORIGIN}/?error=google_unavailable`);
      // Session handshake values are gone (single use).
      const stored = await stored_session(app, cookie);
      assert.equal(stored.google_state, undefined, "state cleared after use");
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });

  test("routes are 404 through the real error handler without credentials", async () => {
    const app = create_test_app({ google_client: { enabled: false, get_config: null } });
    const { base, server } = await listen(app);
    try {
      const start = await fetch(`${base}/api/auth/google/start`, { redirect: "manual" });
      assert.equal(start.status, 404);
      assert.equal((await start.json()).error.code, "NOT_FOUND", "the real error envelope, not a 500");
      const callback = await fetch(`${base}/api/auth/google/callback?state=x&code=y`, { redirect: "manual" });
      assert.equal(callback.status, 404);
      assert.equal((await callback.json()).error.code, "NOT_FOUND");
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });

  test("start is IP-throttled like the other unauthenticated endpoints", async () => {
    const seen = [];
    const ip_throttle = { hit: (key) => seen.push(key), reset: () => {} };
    const app = create_test_app({ google_client: stub_google_client(), ip_throttle });
    const { base, server } = await listen(app);
    try {
      await fetch(`${base}/api/auth/google/start`, { redirect: "manual" });
      assert.ok(seen.some((key) => key.startsWith("google-start:")), "the shared throttle saw a google-start key");
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });
});
