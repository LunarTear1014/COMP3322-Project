import { test } from "node:test";
import assert from "node:assert/strict";
import { timeslot_bounds, utc_to_campus_datetime } from "./timeslots.js";

test("slot bounds reject impossible dates and unknown slots", () => {
  assert.equal(timeslot_bounds("2026-02-30", "10:00 - 12:00"), null);
  assert.equal(timeslot_bounds("2026-11-06", "10:30 - 12:00"), null);
  assert.deepEqual(timeslot_bounds("2028-02-29", "10:00 - 12:00"), {
    start: "2028-02-29 10:00:00", end: "2028-02-29 12:00:00",
  });
});

test("deadline conversion requires a real UTC instant", () => {
  assert.equal(utc_to_campus_datetime("2026-02-30T00:00:00Z"), null);
  assert.equal(utc_to_campus_datetime("2026-11-06T00:00:00+08:00"), null);
  assert.equal(utc_to_campus_datetime("2026-11-06T00:00:00Z"), "2026-11-06 08:00:00");
});
