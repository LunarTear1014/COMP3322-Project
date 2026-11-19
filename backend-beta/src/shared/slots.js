// Campus slots and Hong Kong time mapping (api.md section 4, backend.md 5).
// Hong Kong has no daylight saving time, so the offset is a fixed +08:00.
import { ApiError, validation_error } from "./errors.js";
import { parse_campus_date } from "./validate.js";

const CAMPUS_TIMEZONE = "Asia/Hong_Kong";
const CAMPUS_OFFSET_HOURS = 8;

// Bookings conflict by time overlap, not by slot id, so the full-day slot
// blocks the shorter slots inside it and the other way round.
const SLOTS = [
  { id: "early_morning", name: "Early morning", start: "06:00", end: "08:00" },
  { id: "morning", name: "Morning", start: "10:00", end: "12:00" },
  { id: "afternoon", name: "Afternoon", start: "13:00", end: "15:00" },
  { id: "evening", name: "Evening", start: "16:00", end: "18:00" },
  { id: "night", name: "Night", start: "19:00", end: "21:00" },
  { id: "full_day", name: "Full day", start: "09:00", end: "18:00" },
];
const SLOT_IDS = SLOTS.map((slot) => slot.id);

function slot_by_id(slot_id) {
  return SLOTS.find((slot) => slot.id === slot_id) ?? null;
}

// "2026-11-12" + "10:00" Hong Kong -> Date at 2026-11-12T02:00:00Z.
function campus_to_utc(date, time) {
  const day = parse_campus_date(date);
  if (!day) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const [hours, minutes] = [Number(match[1]), Number(match[2])];
  if (hours > 23 || minutes > 59) return null;
  return new Date(day.getTime() + ((hours - CAMPUS_OFFSET_HOURS) * 60 + minutes) * 60_000);
}

// Resolves a campus date and slot id to UTC start/end, validating that the
// start is strictly in the future relative to `now`.
function resolve_slot(date, slot_id, now = new Date()) {
  const slot = slot_by_id(slot_id);
  if (!slot) throw validation_error({ slot_id: `Choose one of: ${SLOT_IDS.join(", ")}.` });
  const start = campus_to_utc(date, slot.start);
  const end = campus_to_utc(date, slot.end);
  if (!start || !end) throw validation_error({ date: "Use a real date as YYYY-MM-DD." });
  if (start.getTime() <= now.getTime()) {
    throw validation_error({ date: "Choose a slot that starts in the future." });
  }
  return { start, end, slot };
}

// Campus calendar date (YYYY-MM-DD) of a UTC instant.
function utc_to_campus_date(instant) {
  const shifted = new Date(instant.getTime() + CAMPUS_OFFSET_HOURS * 3_600_000);
  return shifted.toISOString().slice(0, 10);
}

// MySQL DATETIME(6) literal in UTC ("2026-11-12 02:00:00.000000").
function to_mysql_utc(instant) {
  return instant.toISOString().replace("T", " ").replace("Z", "000");
}

function from_mysql_utc(text) {
  return new Date(`${text.replace(" ", "T")}Z`);
}

function config_payload({ google_oauth_enabled = false } = {}) {
  return { campus_timezone: CAMPUS_TIMEZONE, slots: SLOTS, google_oauth_enabled };
}

export {
  ApiError,
  CAMPUS_TIMEZONE,
  SLOTS,
  SLOT_IDS,
  campus_to_utc,
  config_payload,
  from_mysql_utc,
  resolve_slot,
  slot_by_id,
  to_mysql_utc,
  utc_to_campus_date,
};
