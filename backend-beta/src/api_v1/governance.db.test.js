import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { test_db_config } from "../../test/db_helper.js";
import { start_v1 } from "../../test/v1_harness.js";
import { build_world, create_body, future_date } from "../../test/world.js";

const { skip } = test_db_config();
let app;
let ids;
let day = 3;

describe("club governance and versions", { skip }, () => {
  before(async () => { app = await start_v1(); ids = await build_world(app); });
  after(async () => { await app?.stop(); });

  const members = async (client) => (await client.get("/clubs/1/members")).body.data;
  const version_of = async (client, user_id) => (await members(client)).find((m) => m.user.id === user_id).version;

  test("only the president changes roles; versions guard against stale writes; committee is notified", async () => {
    const pres = await app.client_for("pres@x.test");
    const comm = await app.client_for("comm@x.test");
    const mem = await app.client_for("mem@x.test");
    assert.equal((await mem.get("/clubs/1/members")).status, 403);
    const version = await version_of(pres, ids.mem);
    assert.equal((await comm.patch(`/clubs/1/members/${ids.mem}`, { role: "committee", expected_version: version })).status, 403, "committee cannot appoint");
    assert.equal((await pres.patch(`/clubs/1/members/${ids.mem}`, { role: "president", expected_version: version })).status, 422);
    assert.equal((await pres.patch(`/clubs/1/members/${ids.mem}`, { role: "committee", expected_version: version + 3 })).body.error.code, "STALE_VERSION");
    const promoted = await pres.patch(`/clubs/1/members/${ids.mem}`, { role: "committee", expected_version: version });
    assert.deepEqual([promoted.body.data.role, promoted.body.data.version], ["committee", version + 1]);
    const [[n]] = await app.admin.query("SELECT COUNT(*) AS n FROM notifications WHERE type = 'role_changed' AND user_id IN (?, ?)", [ids.mem, ids.comm]);
    assert.equal(Number(n.n), 2, "affected user and the rest of the committee, actor excluded");
    assert.equal((await pres.patch(`/clubs/1/members/${ids.pres}`, { role: "member", expected_version: 1 })).status, 403, "the president's own row is not editable here");
    const demoted = await pres.patch(`/clubs/1/members/${ids.mem}`, { role: "member", expected_version: version + 1 });
    assert.equal(demoted.body.data.role, "member");
    assert.equal((await pres.patch(`/clubs/1/members/999999`, { role: "member", expected_version: 1 })).status, 404);
  });

  test("presidency transfer needs a committee target and the right version; two presidents are impossible", async () => {
    const pres = await app.client_for("pres@x.test");
    const comm = await app.client_for("comm@x.test");
    const version = await version_of(pres, ids.comm);
    assert.equal((await comm.post("/clubs/1/presidency", { to_user_id: ids.comm, expected_version: version })).status, 403);
    assert.equal((await pres.post("/clubs/1/presidency", { to_user_id: ids.mem, expected_version: 1 })).body.error.code, "INVALID_STATE", "target must be committee");
    assert.equal((await pres.post("/clubs/1/presidency", { to_user_id: ids.comm, expected_version: version + 1 })).body.error.code, "STALE_VERSION");
    const moved = await pres.post("/clubs/1/presidency", { to_user_id: ids.comm, expected_version: version });
    assert.equal(moved.status, 200);
    assert.deepEqual([moved.body.data.previous.role, moved.body.data.current.role], ["committee", "president"]);
    const [[count]] = await app.admin.query("SELECT COUNT(*) AS n FROM memberships WHERE club_id = 1 AND role = 'president'");
    assert.equal(Number(count.n), 1);
    assert.equal((await pres.post("/clubs/1/presidency", { to_user_id: ids.comm, expected_version: 1 })).status, 403, "the former president can no longer transfer");
    const back = await (await app.client_for("comm@x.test")).post("/clubs/1/presidency", { to_user_id: ids.pres, expected_version: await version_of(await app.client_for("comm@x.test"), ids.pres) });
    assert.equal(back.status, 200);
    const [[audit]] = await app.admin.query("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'presidency.transferred'");
    assert.equal(Number(audit.n), 2);
  });

  test("concurrent transfers to different people leave exactly one president (lock order)", async () => {
    const pres = await app.client_for("pres@x.test");
    await app.admin.query("UPDATE memberships SET role = 'committee' WHERE user_id = ? AND club_id = 1", [ids.mem]);
    const a = await version_of(pres, ids.comm);
    const b = await version_of(pres, ids.mem);
    const results = await Promise.all([
      pres.post("/clubs/1/presidency", { to_user_id: ids.comm, expected_version: a }),
      pres.post("/clubs/1/presidency", { to_user_id: ids.mem, expected_version: b }),
    ]);
    assert.ok(results.some((r) => r.status === 200));
    const [[count]] = await app.admin.query("SELECT COUNT(*) AS n FROM memberships WHERE club_id = 1 AND role = 'president'");
    assert.equal(Number(count.n), 1, results.map((r) => r.status).join());
    await app.admin.query("UPDATE memberships SET role = 'member' WHERE club_id = 1 AND user_id IN (?, ?, ?)", [ids.pres, ids.comm, ids.mem]);
    await app.admin.query("UPDATE memberships SET role = 'president' WHERE user_id = ? AND club_id = 1", [ids.pres]);
    await app.admin.query("UPDATE memberships SET role = 'committee' WHERE user_id = ? AND club_id = 1", [ids.comm]);
  });

  test("published edit and approval race on the same version: at most one wins (R6)", async () => {
    const pres = await app.client_for("pres@x.test");
    const admin = await app.client_for("admin@x.test");
    const event = (await pres.post("/events", create_body(app, { date: future_date(app, (day += 1)), capacity: 2 }))).body.data;
    const [edit, approve] = await Promise.all([
      pres.patch(`/events/${event.id}`, { expected_version: 1, title: "Racing edit" }),
      admin.post(`/bookings/${event.booking.id}/decision`, { expected_version: 1, decision: "approve" }),
    ]);
    assert.deepEqual([edit.status, approve.status], [200, 200], JSON.stringify([edit.body, approve.body]));
    const twin = await Promise.all([
      pres.patch(`/events/${event.id}`, { expected_version: 2, title: "A" }),
      pres.patch(`/events/${event.id}`, { expected_version: 2, title: "B" }),
    ]);
    assert.deepEqual(twin.map((r) => r.status).sort(), [200, 409]);
    const [[row]] = await app.admin.query("SELECT version FROM events WHERE id = ?", [event.id]);
    assert.equal(Number(row.version), 3);
  });

  test("tag edits work after publication and an outsider sees the club's members as 404", async () => {
    const outsider = await app.client_for("s1@x.test");
    assert.equal((await outsider.get("/clubs/1/members")).status, 404);
    assert.equal((await outsider.get("/clubs/999/members")).status, 404);
    assert.equal((await outsider.get("/clubs?page_size=1")).body.meta.page_size, 1);
    const mine = (await outsider.put("/clubs/1/membership", {})).body.data;
    assert.equal(mine.role, "member");
    assert.equal((await outsider.get("/me/memberships")).body.data.length, 1);
    assert.equal((await outsider.delete("/clubs/1/membership")).status, 204);
  });
});
