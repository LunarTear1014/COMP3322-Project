import { ApiError, validation_error } from "./errors.js";

// Strict DTO and query validation (handoff/api.md sections 3 and 6).
// Schema entry kinds: int, string, enum, bool, date, instant.

const UTC_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z$/;
const CAMPUS_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function real_date(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

// Returns a Date for a real YYYY-MM-DD calendar date, otherwise null.
function parse_campus_date(value) {
  const match = typeof value === "string" ? CAMPUS_DATE.exec(value) : null;
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  return real_date(year, month, day) ? new Date(Date.UTC(year, month - 1, day)) : null;
}

// Accepts only YYYY-MM-DDTHH:mm:ss[.1-6 digits]Z with real calendar values.
function parse_utc_instant(value) {
  const match = typeof value === "string" ? UTC_INSTANT.exec(value) : null;
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (!real_date(year, month, day) || hour > 23 || minute > 59 || second > 59) return null;
  const millis = match[7] ? Number(match[7].padEnd(3, "0").slice(0, 3)) : 0;
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second, millis));
}

// URL identifiers: digits only, positive, safe integer, no trailing text.
function parse_positive_id(value) {
  if (typeof value !== "string" || !/^[1-9]\d{0,15}$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function code_points(text) {
  return [...text].length;
}

function check_field(spec, value) {
  switch (spec.kind) {
    case "int": {
      if (!Number.isSafeInteger(value)) return { error: "Enter a whole number." };
      if (value < (spec.min ?? 1)) return { error: `Must be at least ${spec.min ?? 1}.` };
      if (spec.max !== undefined && value > spec.max) return { error: `Must be at most ${spec.max}.` };
      return { value };
    }
    case "string": {
      if (typeof value !== "string") return { error: "Enter text." };
      const text = spec.trim === false ? value : value.trim();
      const min = spec.min ?? 1;
      const length = code_points(text);
      if (length < min) return { error: min === 1 ? "This field is required." : `Use at least ${min} characters.` };
      if (spec.max !== undefined && length > spec.max) return { error: `Use at most ${spec.max} characters.` };
      if (spec.pattern && !spec.pattern.test(text)) return { error: spec.pattern_message || "Invalid format." };
      return { value: spec.lowercase ? text.toLowerCase() : text };
    }
    case "enum":
      return spec.values.includes(value) ? { value } : { error: `Use one of: ${spec.values.join(", ")}.` };
    case "bool":
      return typeof value === "boolean" ? { value } : { error: "Use true or false." };
    case "date": {
      const date = parse_campus_date(value);
      return date ? { value } : { error: "Use a real date as YYYY-MM-DD." };
    }
    case "instant": {
      const date = parse_utc_instant(value);
      return date ? { value, date } : { error: "Use a UTC time such as 2026-11-12T02:00:00Z." };
    }
    default:
      throw new Error(`Unknown field kind: ${spec.kind}`);
  }
}

// Validates a JSON body. Unknown fields are rejected. Returns cleaned values.
function validate_body(body, schema, { at_least_one_of = null } = {}) {
  const fields = {};
  const clean = {};
  for (const key of Object.keys(body)) {
    if (!Object.hasOwn(schema, key)) fields[key] = "Unknown field.";
  }
  for (const [key, spec] of Object.entries(schema)) {
    if (!Object.hasOwn(body, key) || body[key] === undefined) {
      if (spec.required) fields[key] = "This field is required.";
      continue;
    }
    if (body[key] === null && spec.nullable) {
      clean[key] = null;
      continue;
    }
    const result = check_field(spec, body[key]);
    if (result.error) fields[key] = result.error;
    else clean[key] = result.value;
  }
  if (at_least_one_of && !Object.keys(fields).length
    && !at_least_one_of.some((key) => Object.hasOwn(clean, key))) {
    fields.body = `Send at least one of: ${at_least_one_of.join(", ")}.`;
  }
  if (Object.keys(fields).length) throw validation_error(fields);
  return clean;
}

// Query strings: unknown or repeated keys are errors; values stay strings
// unless the schema says otherwise (id, int, bool, enum, string, instant).
function validate_query(query, schema, { repeatable = [] } = {}) {
  const fields = {};
  const clean = {};
  for (const key of Object.keys(query)) {
    if (!Object.hasOwn(schema, key)) fields[key] = "Unknown parameter.";
  }
  for (const [key, spec] of Object.entries(schema)) {
    const raw = query[key];
    if (raw === undefined) {
      if (spec.required) fields[key] = "This parameter is required.";
      continue;
    }
    const list = Array.isArray(raw);
    if (list && !repeatable.includes(key)) {
      fields[key] = "Send this parameter once.";
      continue;
    }
    if (!list && typeof raw !== "string") {
      fields[key] = "Send a plain value.";
      continue;
    }
    const values = list ? raw : [raw];
    const parsed = [];
    for (const value of values) {
      const result = check_query_value(spec, value);
      if (result.error) {
        fields[key] = result.error;
        break;
      }
      parsed.push(result.value);
    }
    if (!fields[key]) clean[key] = list ? parsed : parsed[0];
  }
  if (Object.keys(fields).length) throw validation_error(fields);
  return clean;
}

function check_query_value(spec, raw) {
  switch (spec.kind) {
    case "id": {
      const id = parse_positive_id(raw);
      return id === null ? { error: "Use a positive whole number." } : { value: id };
    }
    case "int": {
      if (!/^\d{1,9}$/.test(raw)) return { error: "Use a whole number." };
      const value = Number(raw);
      if (value < (spec.min ?? 0) || (spec.max !== undefined && value > spec.max)) {
        return { error: `Use a number from ${spec.min ?? 0} to ${spec.max}.` };
      }
      return { value };
    }
    case "bool":
      if (raw === "true") return { value: true };
      if (raw === "false") return { value: false };
      return { error: "Use true or false." };
    default:
      return check_field(spec, raw);
  }
}

const PAGE_QUERY = {
  page: { kind: "int", min: 1, max: 100000 },
  page_size: { kind: "int", min: 1, max: 100 },
};

function pagination(clean) {
  return { page: clean.page ?? 1, page_size: clean.page_size ?? 20 };
}

function assert_range(from, to, max_days) {
  if (!(from < to)) throw validation_error({ to: "to must be after from." });
  if ((to - from) / 86_400_000 > max_days) {
    throw validation_error({ to: `The range can be at most ${max_days} days.` });
  }
}

export {
  ApiError,
  PAGE_QUERY,
  assert_range,
  pagination,
  parse_campus_date,
  parse_positive_id,
  parse_utc_instant,
  validate_body,
  validate_query,
};
