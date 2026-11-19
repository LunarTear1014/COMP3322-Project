import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { create_utc_pool } from "../db/pool.js";
import { prepare_database, test_db_config } from "../../test/db_helper.js";
import { clear_admin_club_roles } from "./admin_club_roles.js";

const { skip } = test_db_config();
let db;
let pool;
let ids;
const count = async (sql, params = []) => Number((await db.admin.query(sql, params))[0][0].n);
const quiet = () => {};

async function user(email, platform_role) {
  const [r] = await db.admin.query("INSERT INTO users (email, password_hash, name, student_id, platform_role) VALUES (?, ?, ?, ?, ?)", [email, "x", email, email, platform_role]);
  return r.insertId;
}

describe("clear admin club roles", { skip }, () => {
  before(async () => {
    db = await prepare_database();
    pool = create_utc_pool({ ...db.config, connection_limit: 4 });
    await db.admin.query("INSERT INTO clubs (id, name) VALUES (1, 'Photo'), (2, 'Film'), (3, 'Debate')");
    ids = { admin: await user("a@x.test", "venue_admin"), student: await user("s@x.test", "student"), pres: await user("p@x.test", "student") };
    await db.admin.query("INSERT INTO memberships (user_id, club_id, role) VALUES (?, 1, 'member'), (?, 2, 'committee'), (?, 1, 'committee'), (?, 3, 'president')",
      [ids.admin, ids.admin, ids.student, ids.pres]);
    await db.admin.query("INSERT INTO club_join_requests (user_id, club_id, status) VALUES (?, 3, 'pending'), (?, 3, 'pending')", [ids.admin, ids.student]);
  });
  after(async () => { await pool?.end(); await db?.close(); });

  test("dry run reports and changes nothing", async () => {
    const lines = [];
    const result = await clear_admin_club_roles({ pool, apply: false, log: (line) => lines.push(line) });
    assert.deepEqual({ blocked: result.blocked, applied: result.applied, memberships: result.memberships, requests: result.requests }, { blocked: false, applied: false, memberships: 2, requests: 1 });
    assert.ok(lines.some((line) => /Would remove committee/.test(line)));
    assert.equal(await count("SELECT COUNT(*) AS n FROM memberships WHERE user_id = ?", [ids.admin]), 2);
    assert.equal(await count("SELECT COUNT(*) AS n FROM club_join_requests WHERE status = 'pending'"), 2);
  });

  test("a venue admin who is a president blocks the whole run", async () => {
    await db.admin.query("DELETE FROM memberships WHERE user_id = ? AND club_id = 3", [ids.pres]);
    await db.admin.query("INSERT INTO memberships (user_id, club_id, role) VALUES (?, 3, 'president')", [ids.admin]);
    const lines = [];
    const result = await clear_admin_club_roles({ pool, apply: true, log: (line) => lines.push(line) });
    assert.equal(result.blocked, true);
    assert.ok(lines.some((line) => /president of Debate/.test(line)));
    assert.equal(await count("SELECT COUNT(*) AS n FROM memberships WHERE user_id = ?", [ids.admin]), 3, "nothing removed");
    assert.equal(await count("SELECT COUNT(*) AS n FROM club_join_requests WHERE status = 'pending'"), 2, "nothing rejected");
    await db.admin.query("DELETE FROM memberships WHERE user_id = ? AND club_id = 3", [ids.admin]);
    await db.admin.query("INSERT INTO memberships (user_id, club_id, role) VALUES (?, 3, 'president')", [ids.pres]);
  });

  test("apply removes admin memberships and rejects their pending requests, leaving students alone", async () => {
    const result = await clear_admin_club_roles({ pool, apply: true, log: quiet, now: new Date("2026-11-16T00:00:00Z") });
    assert.deepEqual({ blocked: result.blocked, applied: result.applied }, { blocked: false, applied: true });
    assert.equal(await count("SELECT COUNT(*) AS n FROM memberships WHERE user_id = ?", [ids.admin]), 0);
    assert.equal(await count("SELECT COUNT(*) AS n FROM memberships"), 2, "student and president rows remain");
    const [rows] = await db.admin.query("SELECT user_id, status, reviewed_at FROM club_join_requests ORDER BY id");
    assert.deepEqual(rows.map((r) => r.status), ["rejected", "pending"]);
    assert.ok(rows[0].reviewed_at);
    const again = await clear_admin_club_roles({ pool, apply: true, log: quiet });
    assert.deepEqual({ memberships: again.memberships, requests: again.requests }, { memberships: 0, requests: 0 });
  });
});
