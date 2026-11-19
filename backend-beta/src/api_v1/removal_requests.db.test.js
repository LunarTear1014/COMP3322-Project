import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { test_db_config } from "../../test/db_helper.js";
import { start_v1 } from "../../test/v1_harness.js";
import { build_world } from "../../test/world.js";

// A committee member's removal request needs the president's sign-off.

const { skip } = test_db_config();
let app;
let ids;
let next = 0;

const role = async (user_id) => (await app.admin.query("SELECT role FROM memberships WHERE club_id = 1 AND user_id = ?", [user_id]))[0][0]?.role ?? null;
const add_member = (user_id) => app.admin.query("INSERT IGNORE INTO memberships (user_id, club_id, role) VALUES (?, 1, 'member')", [user_id]);
const notes = async (user_id, type) => (await app.admin.query(
  "SELECT id, title, body, member_removal_request_id FROM notifications WHERE user_id = ? AND type = ? ORDER BY id", [user_id, type]))[0];
const fresh = async () => { const key = `r${++next}`; const id = await app.user({ email: `${key}@x.test`, name: key, student_id: key }); await add_member(id); return id; };
const decide = (client, request, decision, extra = {}) => client.post(`/clubs/1/removal-requests/${request.id}/decision`, { decision, expected_version: request.version, ...extra });

describe("v1 member removal sign-off", { skip }, () => {
  let comm; let pres; let mem; let admin;
  before(async () => {
    app = await start_v1(); ids = await build_world(app);
    [comm, pres, mem, admin] = await Promise.all(["comm", "pres", "mem", "admin"].map((key) => app.client_for(`${key}@x.test`)));
  });
  after(async () => { await app?.stop(); });

  test("a committee removal creates one pending request and tells only the president", async () => {
    const target = await fresh();
    const asked = await comm.delete(`/clubs/1/members/${target}`, { reason: "Repeated no-shows" });
    assert.equal(asked.status, 202);
    const request = asked.body.data;
    assert.equal(request.status, "pending");
    assert.equal(request.reason, "Repeated no-shows");
    assert.equal(request.user.id, target);
    assert.equal(request.requested_by.name, "comm");
    assert.equal(await role(target), "member", "nothing happens yet");

    const [note] = await notes(ids.pres, "member_removal_request");
    assert.equal(note.member_removal_request_id, request.id);
    assert.equal(note.title, "Removal request: Photo");
    assert.equal(note.body, `comm asked to remove ${request.user.name}.`);
    const listed = (await pres.get("/notifications")).body.data.find((row) => row.type === "member_removal_request");
    assert.equal(listed.removal_request_id, request.id);
    assert.equal((await notes(target, "club_membership")).length, 0, "the member is not told about a pending request");
    assert.equal((await notes(ids.comm, "member_removal_request")).length, 0);

    const again = await comm.delete(`/clubs/1/members/${target}`);
    assert.equal(again.status, 202);
    assert.equal(again.body.data.id, request.id, "the same request comes back");
    assert.equal((await notes(ids.pres, "member_removal_request")).length, 1);

    for (const client of [comm, pres]) {
      const queue = (await client.get("/clubs/1/removal-requests")).body;
      assert.ok(queue.data.some((row) => row.id === request.id && row.user.id === target));
    }
    assert.equal((await mem.get("/clubs/1/removal-requests")).status, 403);
    assert.equal((await admin.get("/clubs/1/removal-requests")).status, 404);
    assert.equal((await comm.get("/clubs/1/removal-requests?status=bogus")).status, 422);
    const log = (await pres.get("/clubs/1/actions")).body.data[0];
    assert.equal(log.type, "removal_requested");
    assert.equal(log.undoable, false);
  });

  test("approving removes the member and tells the requester and the member", async () => {
    const target = await fresh();
    const request = (await comm.delete(`/clubs/1/members/${target}`)).body.data;
    assert.equal((await decide(comm, request, "approve")).status, 403, "only the president decides");
    assert.equal((await decide(pres, { id: request.id, version: request.version + 1 }, "approve")).body.error.code, "STALE_VERSION");
    const done = await decide(pres, request, "approve");
    assert.equal(done.status, 200);
    assert.equal(done.body.data.status, "approved");
    assert.equal(done.body.data.decided_by.name, "pres");
    assert.equal(await role(target), null);
    assert.equal((await notes(target, "club_membership")).length, 1);
    const [told] = await notes(ids.comm, "member_removal_decided");
    assert.match(told.title, /^Removal approved/);
    assert.equal((await notes(ids.pres, "member_removal_request")).filter((n) => n.member_removal_request_id === request.id).length, 0, "the president's buttons are gone");
    const entry = (await pres.get("/clubs/1/actions")).body.data[0];
    assert.equal(entry.type, "member_removed");
    assert.equal(entry.actor.id, ids.pres);
    assert.equal(entry.undoable, true);
    assert.match(entry.description, /requested by comm/);
    assert.equal((await decide(pres, { id: request.id, version: done.body.data.version }, "approve")).body.error.code, "INVALID_STATE");
  });

  test("rejecting needs a reason, keeps the member and tells the requester why", async () => {
    const target = await fresh();
    const request = (await comm.delete(`/clubs/1/members/${target}`)).body.data;
    const noReason = await decide(pres, request, "reject");
    assert.equal(noReason.body.error.code, "VALIDATION_FAILED");
    const done = await decide(pres, request, "reject", { reason: "Give them another term." });
    assert.equal(done.status, 200);
    assert.equal(done.body.data.status, "rejected");
    assert.equal(done.body.data.decision_reason, "Give them another term.");
    assert.equal(await role(target), "member");
    assert.ok((await notes(ids.comm, "member_removal_decided")).some((n) => /Give them another term/.test(n.body)));
    assert.equal((await notes(target, "club_membership")).length, 0);
    assert.equal((await pres.get("/clubs/1/actions")).body.data[0].type, "removal_rejected");
    // A rejected request does not block a new one.
    assert.equal((await comm.delete(`/clubs/1/members/${target}`)).body.data.status, "pending");
  });

  test("the requester can withdraw; another committee member cannot", async () => {
    const target = await fresh();
    const request = (await comm.delete(`/clubs/1/members/${target}`)).body.data;
    const other = await app.user({ email: "comm2@x.test", name: "comm2", student_id: "comm2" });
    await app.admin.query("INSERT INTO memberships (user_id, club_id, role) VALUES (?, 1, 'committee')", [other]);
    const comm2 = await app.client_for("comm2@x.test");
    assert.equal((await comm2.delete(`/clubs/1/removal-requests/${request.id}`)).status, 403);
    assert.equal((await mem.delete(`/clubs/1/removal-requests/${request.id}`)).status, 403);
    const withdrawn = await comm.delete(`/clubs/1/removal-requests/${request.id}`);
    assert.equal(withdrawn.status, 200);
    assert.equal(withdrawn.body.data.status, "withdrawn");
    assert.equal((await notes(ids.pres, "member_removal_request")).filter((n) => n.member_removal_request_id === request.id).length, 0);
    assert.equal((await pres.get("/clubs/1/actions")).body.data[0].type, "removal_withdrawn");
    assert.equal((await comm.delete(`/clubs/1/removal-requests/${request.id}`)).body.error.code, "INVALID_STATE");
    assert.equal((await decide(pres, withdrawn.body.data, "approve")).body.error.code, "INVALID_STATE");
    assert.equal(await role(target), "member");
  });

  test("a member who left or was promoted before approval voids the request", async () => {
    const gone = await fresh();
    const request = (await comm.delete(`/clubs/1/members/${gone}`)).body.data;
    await app.admin.query("DELETE FROM memberships WHERE club_id = 1 AND user_id = ?", [gone]);
    const refused = await decide(pres, request, "approve");
    assert.equal(refused.body.error.code, "INVALID_STATE");
    const [[row]] = await app.admin.query("SELECT status FROM member_removal_requests WHERE id = ?", [request.id]);
    assert.equal(row.status, "void");
    assert.equal((await notes(ids.pres, "member_removal_request")).filter((n) => n.member_removal_request_id === request.id).length, 0);

    const promoted = await fresh();
    const second = (await comm.delete(`/clubs/1/members/${promoted}`)).body.data;
    await app.admin.query("UPDATE memberships SET role = 'committee' WHERE club_id = 1 AND user_id = ?", [promoted]);
    assert.equal((await decide(pres, second, "approve")).body.error.code, "INVALID_STATE");
    assert.equal(await role(promoted), "committee");
    const [[closed]] = await app.admin.query("SELECT status FROM member_removal_requests WHERE id = ?", [second.id]);
    assert.equal(closed.status, "void", "a promoted member's request closes rather than lingering without an inbox item");
  });

  test("targets and callers are checked", async () => {
    const target = await fresh();
    assert.equal((await mem.delete(`/clubs/1/members/${target}`)).status, 403);
    assert.equal((await admin.delete(`/clubs/1/members/${target}`)).status, 404, "venue admins hold no club role");
    assert.equal((await comm.delete(`/clubs/1/members/${ids.pres}`)).status, 403);
    assert.equal((await comm.delete(`/clubs/1/members/${ids.comm}`)).body.error.code, "INVALID_STATE");
    assert.equal((await comm.delete(`/clubs/1/members/${ids.s1 + 9999}`)).status, 404);
    assert.equal((await admin.post("/clubs/1/removal-requests/1/decision", { decision: "approve", expected_version: 1 })).status, 404);
    assert.equal((await mem.post("/clubs/1/removal-requests/1/decision", { decision: "approve", expected_version: 1 })).status, 403);
  });

  test("the president removes at once and that settles any pending request", async () => {
    const quiet = await fresh();
    assert.equal((await pres.delete(`/clubs/1/members/${quiet}`)).status, 204);
    assert.equal(await role(quiet), null);
    assert.equal((await pres.get("/clubs/1/actions")).body.data[0].type, "member_removed");

    const target = await fresh();
    const request = (await comm.delete(`/clubs/1/members/${target}`)).body.data;
    assert.equal((await pres.delete(`/clubs/1/members/${target}`)).status, 204);
    assert.equal(await role(target), null);
    const [[row]] = await app.admin.query("SELECT status, decided_by FROM member_removal_requests WHERE id = ?", [request.id]);
    assert.equal(row.status, "approved");
    assert.equal(row.decided_by, ids.pres);
    assert.equal((await notes(ids.pres, "member_removal_request")).filter((n) => n.member_removal_request_id === request.id).length, 0);
    assert.ok((await notes(ids.comm, "member_removal_decided")).some((n) => /approved/.test(n.title)));
  });
});
