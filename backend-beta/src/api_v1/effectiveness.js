import { readFileSync } from "node:fs";
import { CAMPUS_TIMEZONE } from "../shared/slots.js";
import { assert_range, parse_utc_instant, validate_query } from "../shared/validate.js";
import { ApiError } from "../shared/errors.js";
import { id_param, iso, to_db } from "./common.js";

const sql = (name) => readFileSync(new URL(`../queries/reports/effectiveness/${name}.sql`, import.meta.url), "utf8");
const QUERIES = { events: sql("events"), history: sql("history"), attendance: sql("attendance"), views: sql("views"), tags: sql("tags") };

const asDate = (text) => new Date(`${String(text).replace(" ", "T")}Z`);
const round3 = (n) => Math.round(n * 1000) / 1000;
const rate = (num, den) => (den > 0 ? round3(num / den) : null);
const SOURCES = ["explore", "club", "inbox", "my_events", "share", "other"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SLOTS = { 10: ["morning", "Morning"], 13: ["afternoon", "Afternoon"], 16: ["evening", "Evening"] };

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return round3(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
}

// Metrics for one event from its pre-fetched history, attendance and views.
function event_metrics(event, history, attendance, views) {
  const start = asDate(event.start_time);
  const by_user = new Map();
  for (const row of history) {
    if (!by_user.has(row.user_id)) by_user.set(row.user_id, []);
    by_user.get(row.user_id).push(row);
  }
  let waiting = 0;
  let peak = 0;
  const ever = new Set();
  const promoted = new Set();
  const waits = [];
  let at_start = 0;
  let dropped = 0;
  let promotions = 0;
  for (const row of history) {
    if (row.action === "waitlisted") waiting += 1;
    else if (row.from_status === "waitlisted") waiting -= 1;
    peak = Math.max(peak, waiting);
    if (row.action === "joined" || row.action === "promoted") ever.add(row.user_id);
    if (row.action === "promoted") { promotions += 1; promoted.add(row.user_id); }
  }
  for (const [user_id, rows] of by_user) {
    const before = rows.filter((row) => asDate(row.occurred_at) < start);
    const latest = before.at(-1);
    if (latest && ["joined", "promoted"].includes(latest.action)) at_start += 1;
    if (ever.has(user_id) && latest?.action === "left") dropped += 1;
    for (const row of rows) {
      if (row.action !== "promoted") continue;
      const queued = [...rows].reverse().find((r) => r.id < row.id && r.action === "waitlisted");
      if (queued) waits.push((asDate(row.occurred_at) - asDate(queued.occurred_at)) / 3_600_000);
    }
  }
  const attended = new Set(attendance.map((row) => row.user_id));
  const recorded = Boolean(event.checkin_opened_at) || attended.size > 0;
  const viewers = new Set(views.map((row) => row.user_id));
  const views_by_source = Object.fromEntries(SOURCES.map((source) => [source, 0]));
  let total_views = 0;
  const first_view = new Map();
  for (const row of views) {
    views_by_source[row.source] += Number(row.views);
    total_views += Number(row.views);
    const seen = first_view.get(row.user_id);
    const at = asDate(row.first_view_at);
    if (!seen || at < seen) first_view.set(row.user_id, at);
  }
  let converted = 0;
  for (const [user_id, seen] of first_view) {
    if ((by_user.get(user_id) ?? []).some((row) => ["joined", "promoted"].includes(row.action) && asDate(row.occurred_at) >= seen)) converted += 1;
  }
  const published = event.published_at ? asDate(event.published_at) : null;
  const joins_24h = published
    ? history.filter((row) => row.action === "joined" && asDate(row.occurred_at) >= published && asDate(row.occurred_at) < new Date(published.getTime() + 86_400_000)).length : 0;
  return {
    event_id: event.event_id, title: event.title, start_at: iso(event.start_time), capacity: Number(event.capacity),
    joined_at_start: at_start, fill_rate: rate(at_start, Number(event.capacity)), peak_waitlist: peak, ever_joined: ever.size,
    dropped_out: dropped, dropout_rate: rate(dropped, ever.size), checkin_recorded: recorded,
    attended: recorded ? attended.size : null, turnout: recorded ? rate(attended.size, at_start) : null,
    no_shows: recorded ? Math.max(0, at_start - attended.size) : null, promotions, median_promotion_wait_hours: median(waits),
    promoted_attended: recorded ? [...promoted].filter((user_id) => attended.has(user_id)).length : null,
    views: total_views, unique_viewers: viewers.size, views_by_source, view_to_join: rate(converted, viewers.size), joins_24h_after_publish: joins_24h,
  };
}

function group(list, key_of, name_of) {
  const groups = new Map();
  for (const item of list) {
    for (const key of [].concat(key_of(item))) {
      if (!groups.has(key)) groups.set(key, { key, name: name_of(key), items: [] });
      groups.get(key).items.push(item);
    }
  }
  return [...groups.values()].map(({ key, name, items }) => {
    const turnouts = items.filter((item) => item.turnout !== null).map((item) => item.turnout);
    const fills = items.filter((item) => item.fill_rate !== null).map((item) => item.fill_rate);
    return {
      key, name, events: items.length,
      avg_fill_rate: fills.length ? round3(fills.reduce((a, b) => a + b, 0) / fills.length) : null,
      avg_turnout: turnouts.length ? round3(turnouts.reduce((a, b) => a + b, 0) / turnouts.length) : null,
      too_few: items.length < 3,
    };
  });
}

async function build_report(pool, { club_id, from, to }) {
  const [events] = await pool.query(QUERIES.events, [club_id, to_db(from), to_db(to)]);
  const ids = events.map((event) => event.event_id);
  const fetch = async (name) => (ids.length ? (await pool.query(QUERIES[name], [ids]))[0] : []);
  const [history, attendance, views, tags] = await Promise.all(["history", "attendance", "views", "tags"].map(fetch));
  const bucket = (rows) => { const map = new Map(); for (const row of rows) { if (!map.has(row.event_id)) map.set(row.event_id, []); map.get(row.event_id).push(row); } return map; };
  const [h, a, v, t] = [bucket(history), bucket(attendance), bucket(views), bucket(tags)];
  const metrics = events.map((event) => ({ event, ...event_metrics(event, h.get(event.event_id) ?? [], a.get(event.event_id) ?? [], v.get(event.event_id) ?? []) }));
  const rows = metrics.map(({ event, ...rest }) => rest);
  const tagged = metrics.map(({ event, ...rest }) => ({ ...rest, _tags: (t.get(event.event_id) ?? []).map((tag) => tag.slug), _start: asDate(event.start_time) }));
  const tag_names = new Map(tags.map((tag) => [tag.slug, tag.name]));
  const hk = (date) => new Date(date.getTime() + 8 * 3_600_000);
  return {
    club_id, from: from.toISOString(), to: to.toISOString(), campus_timezone: CAMPUS_TIMEZONE, events: rows,
    by_tag: group(tagged, (item) => item._tags, (slug) => tag_names.get(slug) ?? slug).map(({ key, ...rest }) => ({ slug: key, ...rest })),
    by_weekday: group(tagged, (item) => hk(item._start).getUTCDay(), (day) => WEEKDAYS[day]).map(({ key, name, ...rest }) => ({ weekday: key, name, ...rest })),
    by_slot: group(tagged, (item) => hk(item._start).getUTCHours(), (hour) => SLOTS[hour]?.[1] ?? `${hour}:00`).map(({ key, name, ...rest }) => ({ slot: SLOTS[key]?.[0] ?? String(key), name, ...rest })),
  };
}

function parse_range(query) {
  const parsed = validate_query(query, { from: { kind: "instant", required: true }, to: { kind: "instant", required: true } });
  const from = parse_utc_instant(parsed.from);
  const to = parse_utc_instant(parsed.to);
  assert_range(from, to, 93);
  return { from, to };
}

export { QUERIES, ApiError, build_report, event_metrics, id_param, median, parse_range };
