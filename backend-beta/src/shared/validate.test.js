import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  parse_campus_date,
  parse_positive_id,
  parse_utc_instant,
  validate_body,
  validate_query,
} from "./validate.js";
import {
  SLOTS,
  campus_to_utc,
  from_mysql_utc,
  resolve_slot,
  to_mysql_utc,
  utc_to_campus_date,
} from "./slots.js";

function fields_of(fn) {
  try {
    fn();
  } catch (error) {
    assert.equal(error.code, "VALIDATION_FAILED");
    return error.fields;
  }
  assert.fail("expected a validation error");
}

describe("validation helpers", () => {
  test("campus dates reject impossible calendar days", () => {
    assert.ok(parse_campus_date("2028-02-29"));
    assert.equal(parse_campus_date("2027-02-29"), null);
    assert.equal(parse_campus_date("2026-13-01"), null);
    assert.equal(parse_campus_date("2026-4-01"), null);
  });

  test("UTC instants need the Z suffix and real values", () => {
    assert.equal(parse_utc_instant("2026-11-12T02:00:00Z").toISOString(), "2026-11-12T02:00:00.000Z");
    assert.ok(parse_utc_instant("2026-11-12T02:00:00.123456Z"));
    assert.equal(parse_utc_instant("2026-11-12T02:00:00+08:00"), null);
    assert.equal(parse_utc_instant("2026-11-12T02:00:00"), null);
    assert.equal(parse_utc_instant("2026-02-30T02:00:00Z"), null);
    assert.equal(parse_utc_instant("2026-11-12T24:00:00Z"), null);
  });

  test("ids are strict positive safe integers", () => {
    assert.equal(parse_positive_id("12"), 12);
    for (const bad of ["0", "-1", "1.5", "12abc", "", "01", "99999999999999999999"]) {
      assert.equal(parse_positive_id(bad), null, bad);
    }
  });

  test("bodies reject unknown fields, numeric strings and whitespace-only text", () => {
    const schema = {
      title: { kind: "string", max: 5, required: true },
      capacity: { kind: "int", min: 1, max: 500, required: true },
    };
    assert.deepEqual(validate_body({ title: "  Hi ", capacity: 3 }, schema), { title: "Hi", capacity: 3 });
    assert.deepEqual(fields_of(() => validate_body({ title: "  ", capacity: "3", extra: 1 }, schema)), {
      title: "This field is required.",
      capacity: "Enter a whole number.",
      extra: "Unknown field.",
    });
    assert.ok(fields_of(() => validate_body({ title: "toolong", capacity: 501 }, schema)).title);
  });

  test("string lengths count Unicode code points", () => {
    const schema = { name: { kind: "string", max: 2, required: true } };
    assert.deepEqual(validate_body({ name: "\u{1F600}\u{1F600}" }, schema), { name: "\u{1F600}\u{1F600}" });
    assert.ok(fields_of(() => validate_body({ name: "\u{1F600}\u{1F600}\u{1F600}" }, schema)).name);
  });

  test("at_least_one_of requires a change", () => {
    const schema = { expected_version: { kind: "int", required: true }, title: { kind: "string" } };
    assert.ok(fields_of(() => validate_body({ expected_version: 1 }, schema, { at_least_one_of: ["title"] })).body);
  });

  test("queries reject repeats unless allowed, unknown keys and bad booleans", () => {
    const schema = { club_id: { kind: "id" }, flag: { kind: "bool" }, tag: { kind: "string" } };
    assert.deepEqual(validate_query({ club_id: "3", flag: "true" }, schema), { club_id: 3, flag: true });
    assert.ok(fields_of(() => validate_query({ club_id: ["1", "2"] }, schema)).club_id);
    assert.ok(fields_of(() => validate_query({ flag: "yes" }, schema)).flag);
    assert.ok(fields_of(() => validate_query({ nope: "1" }, schema)).nope);
    assert.deepEqual(validate_query({ tag: ["a", "b"] }, schema, { repeatable: ["tag"] }), { tag: ["a", "b"] });
  });
});

describe("Hong Kong slot mapping", () => {
  test("morning slot maps to 01:00Z-04:00Z", () => {
    const { start, end } = resolve_slot("2026-11-12", "morning", new Date("2026-11-01T00:00:00Z"));
    assert.equal(start.toISOString(), "2026-11-12T01:00:00.000Z");
    assert.equal(end.toISOString(), "2026-11-12T04:00:00.000Z");
  });

  test("new slots map to Hong Kong times", () => {
    const now = new Date("2026-11-01T00:00:00Z");
    const span = (id) => { const { start, end } = resolve_slot("2026-11-12", id, now); return [start.toISOString(), end.toISOString()]; };
    assert.deepEqual(span("early_morning"), ["2026-11-11T22:00:00.000Z", "2026-11-12T01:00:00.000Z"]);
    assert.deepEqual(span("night"), ["2026-11-12T10:00:00.000Z", "2026-11-12T13:00:00.000Z"]);
    assert.deepEqual(span("full_day"), ["2026-11-11T22:00:00.000Z", "2026-11-12T13:00:00.000Z"]);
  });

  test("slot spans are unique, so reports can group by them", () => {
    const spans = SLOTS.map((slot) => `${slot.start}-${slot.end}`);
    assert.equal(new Set(spans).size, spans.length);
  });

  test("the part-day slots run back to back from 06:00 to 21:00", () => {
    const parts = SLOTS.filter((slot) => slot.id !== "full_day").sort((a, b) => a.start.localeCompare(b.start));
    assert.equal(parts[0].start, "06:00");
    assert.equal(parts.at(-1).end, "21:00");
    for (let i = 1; i < parts.length; i += 1) assert.equal(parts[i].start, parts[i - 1].end, parts[i].id);
  });

  test("full day spans every other slot", () => {
    const full = SLOTS.find((slot) => slot.id === "full_day");
    for (const slot of SLOTS) assert.ok(full.start <= slot.start && slot.end <= full.end, slot.id);
  });

  test("Hong Kong midnight is 16:00Z the previous day", () => {
    assert.equal(campus_to_utc("2026-11-09", "00:00").toISOString(), "2026-11-08T16:00:00.000Z");
    assert.equal(utc_to_campus_date(new Date("2026-11-08T16:00:00Z")), "2026-11-09");
    assert.equal(utc_to_campus_date(new Date("2026-11-09T15:59:59Z")), "2026-11-09");
  });

  test("impossible dates, unknown slots and the past are rejected", () => {
    const now = new Date("2026-11-12T00:00:00Z");
    assert.ok(fields_of(() => resolve_slot("2027-02-29", "morning", now)).date);
    assert.ok(fields_of(() => resolve_slot("2026-11-12", "midnight", now)).slot_id);
    // The morning slot starts exactly at 01:00Z; now is before it, so valid.
    assert.ok(resolve_slot("2026-11-12", "morning", now));
    // At or after the start instant the slot is no longer in the future.
    assert.ok(fields_of(() => resolve_slot("2026-11-12", "morning", new Date("2026-11-12T01:00:00Z"))).date);
    assert.ok(fields_of(() => resolve_slot("2026-11-12", "morning", new Date("2026-11-12T03:00:00Z"))).date);
  });

  test("fixed slots do not overlap and adjacent days stay distinct", () => {
    const a = resolve_slot("2026-11-12", "evening", new Date("2026-11-01T00:00:00Z"));
    const b = resolve_slot("2026-11-13", "morning", new Date("2026-11-01T00:00:00Z"));
    assert.ok(a.end <= b.start);
  });

  test("MySQL UTC literals round-trip", () => {
    const instant = new Date("2026-11-12T02:00:00.000Z");
    assert.equal(to_mysql_utc(instant), "2026-11-12 02:00:00.000000");
    assert.equal(from_mysql_utc("2026-11-12 02:00:00.000000").toISOString(), instant.toISOString());
  });
});
