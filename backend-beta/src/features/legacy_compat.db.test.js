import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { prepare_database, test_db_config } from "../../test/db_helper.js";

// The legacy /api routes stay mounted next to /api/v1, so after the UTC backfill
// they must still read and write campus-local slots correctly.
const { config, skip } = test_db_config();
let db;
let events;
let venues;
let slots;

describe("legacy services after the UTC backfill", { skip }, () => {
  before(async () => {
    db = await prepare_database();
    // The legacy services read DB_* from the environment when first imported.
    Object.assign(process.env, { DB_HOST: config.host, DB_PORT: String(config.port), DB_USER: config.user, DB_PASSWORD: config.password, DB_NAME: config.database });
    await db.admin.query(`
      INSERT INTO users (id, email, password_hash, name, student_id) VALUES (1, 'a@t.test', 'x', 'A', 's1');
      INSERT INTO clubs (id, name) VALUES (1, 'Club');
      INSERT INTO venues (id, name, location, capacity) VALUES (1, 'Hall', 'L1', 50);
      INSERT INTO memberships (user_id, club_id, role) VALUES (1, 1, 'president');`);
    events = await import("./events/events.service.js");
    venues = await import("./venues/venues.service.js");
    slots = await import("../shared/timeslots.js");
  });
  after(async () => { const pool = (await import("../config/db.js")).default; await pool.end(); await db.close(); });

  test("a 13:00-15:00 campus slot is stored as 05:00-07:00 UTC and read back as 13:00 - 15:00", async () => {
    const date = "2030-03-04";
    const bounds = slots.timeslot_bounds(date, "13:00 - 15:00");
    assert.deepEqual(bounds, { start: "2030-03-04 05:00:00", end: "2030-03-04 07:00:00" });
    const created = await events.create_event({ club: "Club", title: "T", description: "D", date, venue: "Hall", timeslot: "13:00 - 15:00", visibility: "Public", bounds, user_id: 1 });
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.equal(created.event.date, date);
    assert.equal(created.event.timeslot, "13:00 - 15:00");
    const [[row]] = await db.admin.query("SELECT start_time FROM events");
    assert.equal(row.start_time, "2030-03-04 05:00:00.000000");
    const listed = await events.list_events(1);
    assert.equal(listed[0].timeslot, "13:00 - 15:00");
  });

  test("availability marks the booked slot busy and adjacent slots free", async () => {
    const [hall] = await venues.list_venues_with_availability("2030-03-04");
    assert.deepEqual(hall.timeslots.map((s) => s.available), [true, false, true]);
  });

  test("a second booking of the same local slot is a conflict", async () => {
    const bounds = slots.timeslot_bounds("2030-03-04", "13:00 - 15:00");
    const again = await events.create_event({ club: "Club", title: "T2", description: "D", date: "2030-03-04", venue: "Hall", timeslot: "13:00 - 15:00", visibility: "Public", bounds, user_id: 1 });
    assert.equal(again.ok, false);
    assert.equal(again.reason, "conflict");
  });
});
