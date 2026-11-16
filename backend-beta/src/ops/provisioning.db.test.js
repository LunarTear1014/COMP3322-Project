import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { test_db_config } from "../../test/db_helper.js";
import { start_v1 } from "../../test/v1_harness.js";
import { PRESIDENT_NAMES, provision_admin, provision_presidents } from "./dev_provisioning.js";
import { create_password_hasher } from "../features/users/password_hasher.js";

const { skip } = test_db_config();
let app;
const FAST = { N: 2 ** 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

describe("development provisioning", { skip }, () => {
  before(async () => { app = await start_v1(); });
  after(async () => { await app?.stop(); });

  test("each club without a president gets a generated fictional one, idempotently, and can log in with the env password", async () => {
    const seed = (await import("node:fs")).readFileSync(new URL("../../db/deployment-seed.sql", import.meta.url), "utf8");
    await app.admin.query(seed);
    await app.user({ email: "existing@x.test", student_id: "E-1" });
    await app.admin.query("INSERT INTO memberships (user_id, club_id, role) SELECT u.id, c.id, 'committee' FROM users u, clubs c WHERE u.email = 'existing@x.test' AND c.name = 'Photography Society'");
    const hasher = create_password_hasher({ params: FAST });
    const first = await provision_presidents(app.pool, { password: "dev-password-123", hasher });
    assert.deepEqual(first.map((r) => [r.club, r.name]), [["Photography Society", "Chan Hiu Tung"], ["Film Society", "Leung Ka Ho"], ["Debate Club", "Wong Tsz Yan"]]);
    assert.ok(first.every((r) => r.email.endsWith("@clubspace.example") && /^PRES-\d{3}$/.test(r.student_id)));
    assert.equal(first.length, Object.keys(PRESIDENT_NAMES).slice(0, 3).length);
    assert.deepEqual(await provision_presidents(app.pool, { password: "other-password-1", hasher }), [], "idempotent");
    const [[n]] = await app.admin.query("SELECT COUNT(*) AS n FROM memberships WHERE role = 'president'");
    assert.equal(Number(n.n), 3);
    const [[c]] = await app.admin.query("SELECT role FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = 'existing@x.test'");
    assert.equal(c.role, "committee", "existing committee members are never promoted by inference");
    const client = app.client();
    assert.equal((await client.login("president.club1@clubspace.example", "dev-password-123")).status, 200);
    const session = await client.get("/auth/session");
    assert.equal(session.body.data.memberships[0].role, "president");
  });

  test("placeholder hashes cannot authenticate and no fixed admin exists unless provisioned (never in production)", async () => {
    await app.admin.query("INSERT INTO users (email, password_hash, name, student_id) VALUES ('ph@x.test', 'placeholder', 'P', 'PH-1'), ('ph2@x.test', '', 'P2', 'PH-2')");
    for (const email of ["ph@x.test", "ph2@x.test"]) assert.equal((await app.client().login(email, "placeholder")).status, 401);
    assert.equal(Number((await app.admin.query("SELECT COUNT(*) AS n FROM users WHERE platform_role = 'venue_admin'"))[0][0].n), 0, "migrations seed no administrator");
    await assert.rejects(() => provision_admin(app.pool, { env: { NODE_ENV: "production" } }), /production/);
    await provision_admin(app.pool, { password: "dev-admin-pass-1", hasher: create_password_hasher({ params: FAST }) });
    assert.equal((await app.client().login("admin@clubspace.example", "dev-admin-pass-1")).status, 200);
  });
});
