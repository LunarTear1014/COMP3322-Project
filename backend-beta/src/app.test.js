import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import express from "express";
import { create_app } from "./app.js";
import { define_route } from "./api_v1/router.js";
import { create_v1_stack } from "./api_v1/stack.js";

const ORIGIN = "http://app.test";
let server;
let base;
const logged = [];

// Enough pool surface for the stack to assemble: the notifications repository
// only captures it, no query runs until the stream hub starts.
function stub_pool() {
  return { query: async () => [[], []], getConnection: async () => { throw new Error("no database in this test"); } };
}

before(async () => {
  // Probe routes exercise the pipeline without a database.
  const probe = express.Router();
  define_route(probe, "/boom", {
    get: () => { throw new Error("secret internals 12345"); },
  });
  define_route(probe, "/echo", {
    post: (req, res) => res.json({ data: req.body }),
  });
  const app = create_app({
    session_secret: "x".repeat(32),
    app_origin: ORIGIN,
    v1_routers: [probe],
    logger: { error: (...args) => logged.push(args.join(" ")) },
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function csrf() {
  const response = await fetch(`${base}/api/v1/auth/csrf`);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const { data } = await response.json();
  return { cookie, token: data.csrf_token };
}

function post_headers({ cookie, token }, extra = {}) {
  return { "Content-Type": "application/json", Origin: ORIGIN, Cookie: cookie, "X-CSRF-Token": token, ...extra };
}

describe("v1 pipeline", () => {
  test("config returns campus slots and an X-Request-Id header", async () => {
    const response = await fetch(`${base}/api/v1/config`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("x-request-id"), /^req-/);
    const { data } = await response.json();
    assert.equal(data.campus_timezone, "Asia/Hong_Kong");
    assert.deepEqual(data.slots.map((slot) => slot.id), ["morning", "afternoon", "evening"]);
  });

  test("config reports google_oauth_enabled false when no v1 router supplies the flag", async () => {
    const response = await fetch(`${base}/api/v1/config`);
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.equal(data.google_oauth_enabled, false);
  });

  test("config reports google_oauth_enabled true when the stack enables Google", async () => {
    const probe = express.Router();
    define_route(probe, "/__probe", { get: (_req, res) => res.json({ data: {} }) });
    const app = create_app({
      session_secret: "x".repeat(32),
      app_origin: ORIGIN,
      ...(() => { const stack = create_v1_stack({ pool: stub_pool(), google_client: { enabled: true }, app_origin: ORIGIN }); return { v1_routers: [...stack.routers, probe], google_oauth_enabled: stack.google_oauth_enabled }; })(),
      logger: { error: () => {} },
    });
    const probe_server = app.listen(0);
    await new Promise((resolve) => probe_server.once("listening", resolve));
    try {
      const base = `http://127.0.0.1:${probe_server.address().port}`;
      const { data } = await (await fetch(`${base}/api/v1/config`)).json();
      assert.equal(data.google_oauth_enabled, true);
      assert.equal((await fetch(`${base}/api/v1/__probe`)).status, 200);
    } finally {
      probe_server.closeAllConnections?.();
      probe_server.close();
    }
  });

  test("unknown route returns a 404 envelope with request_id", async () => {
    const response = await fetch(`${base}/api/v1/nothing`);
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error.code, "NOT_FOUND");
    assert.deepEqual(body.error.fields, {});
    assert.equal(body.error.request_id, response.headers.get("x-request-id"));
  });

  test("unsupported method returns 405 with Allow once CSRF passes", async () => {
    const session = await csrf();
    const response = await fetch(`${base}/api/v1/config`, {
      method: "POST", headers: post_headers(session), body: "{}",
    });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET");
    assert.equal((await response.json()).error.code, "METHOD_NOT_ALLOWED");
  });

  test("mutation without a token, or with a wrong Origin, is rejected", async () => {
    const session = await csrf();
    const missing = await fetch(`${base}/api/v1/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: session.cookie },
      body: "{}",
    });
    assert.equal(missing.status, 403);
    assert.equal((await missing.json()).error.code, "CSRF_INVALID");
    const origin = await fetch(`${base}/api/v1/echo`, {
      method: "POST", headers: post_headers(session, { Origin: "http://evil.test" }), body: "{}",
    });
    assert.equal(origin.status, 403);
    assert.equal((await origin.json()).error.code, "ORIGIN_INVALID");
    const stale = await fetch(`${base}/api/v1/echo`, {
      method: "POST", headers: post_headers({ ...session, token: "stale" }), body: "{}",
    });
    assert.equal((await stale.json()).error.code, "CSRF_INVALID");
  });

  test("a valid session, origin and token reach the handler", async () => {
    const session = await csrf();
    const response = await fetch(`${base}/api/v1/echo`, {
      method: "POST", headers: post_headers(session), body: JSON.stringify({ hello: "world" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, { hello: "world" });
  });

  test("csrf token is stable within a session", async () => {
    const { cookie, token } = await csrf();
    const again = await fetch(`${base}/api/v1/auth/csrf`, { headers: { Cookie: cookie } });
    assert.equal((await again.json()).data.csrf_token, token);
  });

  test("wrong media type, bad JSON, oversize and non-object bodies map to 415, 400, 413, 422", async () => {
    const session = await csrf();
    const send = (headers, body) => fetch(`${base}/api/v1/echo`, { method: "POST", headers: post_headers(session, headers), body });
    assert.equal((await send({ "Content-Type": "text/plain" }, "hi")).status, 415);
    const bad = await send({}, "{oops");
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, "INVALID_JSON");
    assert.equal((await send({}, JSON.stringify({ x: "a".repeat(70 * 1024) }))).status, 413);
    assert.equal((await send({}, "[]")).status, 422);
  });

  test("unexpected errors are sanitized and logged with the request id", async () => {
    const response = await fetch(`${base}/api/v1/boom`);
    assert.equal(response.status, 500);
    const text = await response.text();
    assert.ok(!text.includes("secret internals"));
    const body = JSON.parse(text);
    assert.equal(body.error.code, "INTERNAL_ERROR");
    assert.ok(logged.some((line) => line.includes(body.error.request_id)));
  });
});
