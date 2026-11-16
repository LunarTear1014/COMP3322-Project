import assert from "node:assert/strict";
import { test } from "node:test";
import { timeslot_bounds, today } from "./timeslots.js";

test("today is the Hong Kong date, not the UTC date", () => {
  // 2026-11-16 23:30 UTC is 2026-11-17 07:30 in Hong Kong.
  assert.equal(today(Date.parse("2026-11-16T23:30:00Z")), "2026-11-17");
  assert.equal(today(Date.parse("2026-11-16T15:59:59Z")), "2026-11-16");
});

test("timeslot_bounds rejects impossible and malformed dates", () => {
  assert.equal(timeslot_bounds("2026-02-30", "10:00 - 12:00"), null);
  assert.equal(timeslot_bounds("2026-2-3", "10:00 - 12:00"), null);
  assert.equal(timeslot_bounds(undefined, "10:00 - 12:00"), null);
  assert.equal(timeslot_bounds("2026-11-20", "09:00 - 11:00"), null);
  assert.deepEqual(timeslot_bounds("2026-11-20", "10:00 - 12:00"), { start: "2026-11-20 02:00:00", end: "2026-11-20 04:00:00" });
});
