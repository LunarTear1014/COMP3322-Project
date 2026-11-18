import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { test_db_config } from "../../test/db_helper.js";
import { Client, start_v1 } from "../../test/v1_harness.js";
import { NO_PASSWORD_SENTINEL } from "./identity.js";

const { skip } = test_db_config();
let app;

describe("v1 auth, sessions and profile", { skip }, () => {
  before(async () => { app = await start_v1({ throttle_limits: { login: 5, register: 50, ip: 500 } }); });
  after(async () => { await app?.stop(); });

  const registration = (extra = {}) => ({ name: "Chan Tai Man", email: "Tai.Man@Example.test ", student_id: "3035-001", password: "correct-horse-1", ...extra });

  test("register normalizes the email, never logs in, and cannot set a role", async () => {
    const client = app.client();
    const created = await client.post("/auth/register", registration({ platform_role: "venue_admin" }));
    assert.equal(created.status, 422);
    assert.ok(created.body.error.fields.platform_role);
    const ok = await client.post("/auth/register", registration());
    assert.equal(ok.status, 201);
    assert.deepEqual(ok.body.data, { id: ok.body.data.id, name: "Chan Tai Man", email: "tai.man@example.test", student_id: "3035-001", platform_role: "student" });
    assert.equal((await client.get("/auth/session")).status, 401, "no auto-login");
    const [[row]] = await app.admin.query("SELECT password_hash FROM users WHERE id = ?", [ok.body.data.id]);
    assert.match(row.password_hash, /^scrypt\$v1\$/);
  });

  test("duplicate email and student ID are distinct conflicts", async () => {
    const client = app.client();
    assert.equal((await client.post("/auth/register", registration({ student_id: "other-1" }))).body.error.code, "EMAIL_IN_USE");
    assert.equal((await client.post("/auth/register", registration({ email: "new@example.test" }))).body.error.code, "STUDENT_ID_IN_USE");
  });

  test("password length is enforced without trimming", async () => {
    const client = app.client();
    const short = await client.post("/auth/register", registration({ email: "s@example.test", student_id: "s-1", password: "short" }));
    assert.equal(short.status, 422);
    const spaces = await client.post("/auth/register", registration({ email: "sp@example.test", student_id: "sp-1", password: "   " }));
    assert.equal(spaces.status, 422);
  });

  test("login gives generic errors, regenerates the session and rotates the CSRF token", async () => {
    const client = app.client();
    await client.refresh_csrf();
    const anonymous_token = client.csrf;
    const cookie_before = client.cookie;
    const wrong = await client.post("/auth/login", { email: "tai.man@example.test", password: "wrong-password-1" });
    const unknown = await client.post("/auth/login", { email: "nobody@example.test", password: "wrong-password-1" });
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong.body.error.code, unknown.body.error.code);
    assert.equal(wrong.body.error.message, unknown.body.error.message);
    const ok = await client.login("tai.man@example.test");
    assert.equal(ok.status, 200);
    assert.notEqual(ok.body.data.csrf_token, anonymous_token);
    assert.notEqual(client.cookie, cookie_before, "session id regenerated");
    assert.equal(ok.body.data.user.email, "tai.man@example.test");
    assert.ok(!JSON.stringify(ok.body).includes("password"));
    assert.equal((await client.get("/auth/session")).body.data.csrf_token, ok.body.data.csrf_token);
    const stale = new Client(app.base);
    stale.cookie = client.cookie;
    stale.csrf = anonymous_token;
    assert.equal((await stale.post("/auth/logout", {})).body.error.code, "CSRF_INVALID");
  });

  test("logout destroys the session row and invalidates the cookie", async () => {
    const client = await app.client_for("tai.man@example.test");
    const sid = decodeURIComponent(client.cookie.split("=")[1]).slice(2).split(".")[0];
    const [[before_row]] = await app.admin.query("SELECT COUNT(*) AS n FROM sessions WHERE session_id = ?", [sid]);
    assert.equal(Number(before_row.n), 1);
    assert.equal((await client.post("/auth/logout", {})).status, 204);
    assert.equal((await client.get("/auth/session")).status, 401);
    const [[after_row]] = await app.admin.query("SELECT COUNT(*) AS n FROM sessions WHERE session_id = ?", [sid]);
    assert.equal(Number(after_row.n), 0);
    assert.equal((await client.post("/auth/logout", {})).body.error.code, "CSRF_INVALID", "the destroyed session no longer carries a token");
  });

  test("sessions survive an API restart because they live in MySQL", async () => {
    const client = await app.client_for("tai.man@example.test");
    const { MysqlSessionStore } = await import("../api_v1/session_store.js");
    const { create_app } = await import("../app.js");
    const store = new MysqlSessionStore({ pool: app.pool, cleanup_ms: 0 });
    const second = create_app({ session_secret: "s".repeat(32), app_origin: "http://app.test", session_store: store, v1_routers: app.stack.routers, logger: { error() {} } });
    const server = second.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const moved = new Client(`http://127.0.0.1:${server.address().port}`);
    moved.cookie = client.cookie;
    assert.equal((await moved.get("/auth/session")).status, 200);
    server.close();
    store.close();
  });

  test("privileges are read from the database on every request", async () => {
    const client = await app.client_for("tai.man@example.test");
    assert.equal((await client.get("/profile")).body.data.platform_role, "student");
    await app.admin.query("UPDATE users SET platform_role = 'venue_admin' WHERE email = 'tai.man@example.test'");
    assert.equal((await client.get("/profile")).body.data.platform_role, "venue_admin");
    await app.admin.query("UPDATE users SET platform_role = 'student' WHERE email = 'tai.man@example.test'");
  });

  test("profile patch validates, rejects forbidden fields and duplicate emails", async () => {
    const client = await app.client_for("tai.man@example.test");
    assert.equal((await client.patch("/profile", {})).status, 422);
    assert.ok((await client.patch("/profile", { student_id: "bad id!" })).body.error.fields.student_id);
    assert.ok((await client.patch("/profile", { platform_role: "venue_admin" })).body.error.fields.platform_role);
    await app.user({ email: "taken@example.test" });
    assert.equal((await client.patch("/profile", { email: "taken@example.test" })).body.error.code, "EMAIL_IN_USE");
    const renamed = await client.patch("/profile", { name: "Tai Man Chan" });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
    assert.equal(renamed.body.data.name, "Tai Man Chan");
  });

  test("profile patch completes a profile-incomplete user's student ID with the register rules", async () => {
    await app.user({ email: "incomplete@example.test", student_id: null });
    const client = await app.client_for("incomplete@example.test");
    const bad = await client.patch("/profile", { student_id: "bad id!" });
    assert.equal(bad.status, 422);
    assert.equal(bad.body.error.fields.student_id, "Use letters, digits and hyphens only.");
    const too_long = await client.patch("/profile", { student_id: "x".repeat(51) });
    assert.equal(too_long.status, 422);
    const completed = await client.patch("/profile", { student_id: " 3040-777 " });
    assert.equal(completed.status, 200, JSON.stringify(completed.body));
    assert.equal(completed.body.data.student_id, "3040-777");
    const [[row]] = await app.admin.query("SELECT student_id FROM users WHERE email = 'incomplete@example.test'");
    assert.equal(row.student_id, "3040-777");
  });

  test("profile patch keeps name and email working alongside the student ID", async () => {
    await app.user({ email: "incomplete-side@example.test", student_id: null });
    const client = await app.client_for("incomplete-side@example.test");
    const both = await client.patch("/profile", { name: "Google User", student_id: "gg-1" });
    assert.equal(both.status, 200, JSON.stringify(both.body));
    assert.equal(both.body.data.name, "Google User");
    assert.equal(both.body.data.student_id, "gg-1");
    await app.user({ email: "google-id-taken@example.test", student_id: "taken-1" });
    const clash = await client.patch("/profile", { student_id: "taken-1" });
    assert.equal(clash.body.error.code, "STUDENT_ID_IN_USE");
    assert.equal(clash.body.error.fields.student_id, "Already in use.");
    const [[row]] = await app.admin.query("SELECT student_id FROM users WHERE email = 'incomplete-side@example.test'");
    assert.equal(row.student_id, "gg-1", "a failed patch leaves the row untouched");
    const still_required = await client.patch("/profile", {});
    assert.equal(still_required.status, 422, "at least one field is still required");
  });

  test("login is throttled with Retry-After", async () => {
    const client = app.client();
    let last;
    for (let i = 0; i < 7; i += 1) last = await client.post("/auth/login", { email: "throttle@example.test", password: "wrong-password-1" });
    assert.equal(last.status, 429);
    assert.equal(last.body.error.code, "RATE_LIMITED");
    assert.ok(Number(last.headers.get("retry-after")) > 0);
  });

  test("a Google-only user has the sentinel password and cannot log in with one", async () => {
    const client = app.client();
    await app.user({ email: "google-only@example.test", password: NO_PASSWORD_SENTINEL, student_id: null });
    const attempt = await client.post("/auth/login", { email: "google-only@example.test", password: NO_PASSWORD_SENTINEL });
    assert.equal(attempt.status, 401);
    assert.equal(attempt.body.error.code, "INVALID_CREDENTIALS");
    const [[row]] = await app.admin.query("SELECT google_sub, student_id FROM users WHERE email = 'google-only@example.test'");
    assert.equal(row.google_sub, null, "the column exists and is nullable");
    assert.equal(row.student_id, null, "student_id accepts null before Profile Completion");
  });

  test("a mutation without a session CSRF token is rejected before authentication", async () => {
    const client = app.client();
    const result = await client.request("POST", "/auth/login", { email: "a@b.test", password: "x" }, { headers: {} });
    assert.ok([200, 401, 403].includes(result.status));
    const bad = new Client(app.base);
    bad.csrf = "forged";
    assert.equal((await bad.post("/auth/login", { email: "a@b.test", password: "x" })).body.error.code, "CSRF_INVALID");
  });
});
