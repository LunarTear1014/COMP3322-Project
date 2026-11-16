import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { test_db_config } from "../../test/db_helper.js";
import { start_v1 } from "../../test/v1_harness.js";
import { build_world, future_date, published_event } from "../../test/world.js";

// Beta club management on v1: remove a member, leave the committee, and the
// president's action log with undo (club_action_log).

const { skip } = test_db_config();
let app;
let ids;
let day = 3;

const role = async (user_id) => (await app.admin.query("SELECT role FROM memberships WHERE club_id = 1 AND user_id = ?", [user_id]))[0][0]?.role ?? null;
const version = async (client, user_id) => (await client.get("/clubs/1/members")).body.data.find((row) => row.user_id === user_id || row.user?.id === user_id)?.version;
const add_member = (user_id, r = "member") => app.admin.query("INSERT INTO memberships (user_id, club_id, role) VALUES (?, 1, ?)", [user_id, r]);
const latest = async (pres) => (await pres.get("/clubs/1/actions")).body.data[0];

describe("v1 club management and action log", { skip }, () => {
  before(async () => { app = await start_v1(); ids = await build_world(app); });
  after(async () => { await app?.stop(); });

  test("committee removes a plain member, ending their members-only places and promoting a waiter", async () => {
    await add_member(ids.s1);
    await add_member(ids.s2);
    const event = await published_event(app, ids, { date: future_date(app, (day += 1)), visibility: "members_only", capacity: 1 });
    const comm = await app.client_for("comm@x.test");
    for (const key of ["s1", "s2"]) {
      const student = await app.client_for(`${key}@x.test`);
      await student.post(`/events/${event.id}/registration`, { allow_waitlist: true });
      await comm.post(`/events/${event.id}/join-requests/${ids[key]}/decision`, { decision: "accept" });
    }
    const mem = await app.client_for("mem@x.test");
    assert.equal((await mem.delete(`/clubs/1/members/${ids.s1}`)).status, 403, "plain members can't remove anyone");
    assert.equal((await comm.delete(`/clubs/1/members/${ids.pres}`)).status, 403, "only plain members can be removed");
    assert.equal((await comm.delete(`/clubs/1/members/${ids.comm}`)).body.error.code, "INVALID_STATE");
    assert.equal((await comm.delete(`/clubs/1/members/${ids.s1}`)).status, 204);
    assert.equal(await role(ids.s1), null);
    const [[gone]] = await app.admin.query("SELECT status FROM participations WHERE event_id = ? AND user_id = ?", [event.id, ids.s1]);
    assert.equal(gone.status, "left");
    const [[up]] = await app.admin.query("SELECT status FROM participations WHERE event_id = ? AND user_id = ?", [event.id, ids.s2]);
    assert.equal(up.status, "joined", "the waiter takes the freed seat");
    const [[told]] = await app.admin.query("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'club_membership'", [ids.s1]);
    assert.equal(Number(told.n), 1);

    // The president undoes it; membership (not the event seat) comes back.
    const pres = await app.client_for("pres@x.test");
    const entry = await latest(pres);
    assert.equal(entry.type, "member_removed");
    assert.equal(entry.target.id, ids.s1);
    assert.equal(entry.undoable, true);
    assert.equal((await pres.post(`/clubs/1/actions/${entry.id}/undo`, {})).status, 200);
    assert.equal(await role(ids.s1), "member");
    assert.equal((await pres.post(`/clubs/1/actions/${entry.id}/undo`, {})).body.error.code, "INVALID_STATE", "undo once");
    assert.equal((await latest(pres)).type, "action_undone");
  });

  test("a committee member steps down; the president can undo it", async () => {
    await add_member(ids.s3, "committee");
    const s3 = await app.client_for("s3@x.test");
    const stepped = await s3.delete("/clubs/1/committee");
    assert.equal(stepped.status, 200);
    assert.equal(stepped.body.data.role, "member");
    assert.equal((await s3.delete("/clubs/1/committee")).body.error.code, "INVALID_STATE");
    const pres = await app.client_for("pres@x.test");
    assert.equal((await pres.delete("/clubs/1/committee")).body.error.code, "PRESIDENT_TRANSFER_REQUIRED");
    const entry = await latest(pres);
    assert.equal(entry.type, "committee_left");
    await pres.post(`/clubs/1/actions/${entry.id}/undo`, {});
    assert.equal(await role(ids.s3), "committee");
  });

  test("role changes are logged, undo bumps the version, and a later action blocks undo", async () => {
    await add_member(ids.s4);
    const pres = await app.client_for("pres@x.test");
    const before_version = await version(pres, ids.s4);
    await pres.patch(`/clubs/1/members/${ids.s4}`, { role: "committee", expected_version: before_version });
    const promoted = await latest(pres);
    assert.equal(promoted.type, "member_promoted");
    await pres.patch(`/clubs/1/members/${ids.s4}`, { role: "member", expected_version: before_version + 1 });
    assert.equal((await latest(pres)).type, "member_demoted");
    const blocked = await pres.post(`/clubs/1/actions/${promoted.id}/undo`, {});
    assert.equal(blocked.body.error.code, "INVALID_STATE");
    assert.match(blocked.body.error.message, /later action/);
    const demoted = await latest(pres);
    await pres.post(`/clubs/1/actions/${demoted.id}/undo`, {});
    assert.equal(await role(ids.s4), "committee");
    assert.equal(await version(pres, ids.s4), before_version + 3, "every role write bumps the version");
    const comm = await app.client_for("comm@x.test");
    assert.equal((await comm.get("/clubs/1/actions")).status, 403, "the log is president-only");
    assert.equal((await comm.post(`/clubs/1/actions/${demoted.id}/undo`, {})).status, 403);
  });

  test("undoing an accepted join request removes the membership and reopens the request", async () => {
    const outsider = await app.user({ email: "joiner@x.test", name: "joiner" });
    const joiner = await app.client_for("joiner@x.test");
    const asked = (await joiner.put("/clubs/1/membership", {})).body.data;
    const comm = await app.client_for("comm@x.test");
    await comm.post(`/clubs/1/join-requests/${asked.id}/review`, { decision: "accept" });
    const pres = await app.client_for("pres@x.test");
    const entry = await latest(pres);
    assert.equal(entry.type, "join_request_accepted");
    assert.equal((await pres.post(`/clubs/1/actions/${entry.id}/undo`, {})).status, 200);
    assert.equal(await role(outsider), null);
    const [[request]] = await app.admin.query("SELECT status FROM club_join_requests WHERE id = ?", [asked.id]);
    assert.equal(request.status, "pending");
    const [reopened] = await app.admin.query("SELECT user_id FROM notifications WHERE club_join_request_id = ?", [asked.id]);
    assert.ok(reopened.length >= 2, "committee can review it again");
  });

  test("undoing a presidency transfer swaps the roles back", async () => {
    const pres = await app.client_for("pres@x.test");
    const comm_version = await version(pres, ids.comm);
    assert.equal((await pres.post("/clubs/1/presidency", { to_user_id: ids.comm, expected_version: comm_version })).status, 200);
    const comm = await app.client_for("comm@x.test");
    const entry = await latest(comm);
    assert.equal(entry.type, "presidency_transferred");
    // The new president undoes it (the legacy undo always refused this).
    assert.equal((await comm.post(`/clubs/1/actions/${entry.id}/undo`, {})).status, 200);
    assert.equal(await role(ids.pres), "president");
    assert.equal(await role(ids.comm), "committee");
  });
});
