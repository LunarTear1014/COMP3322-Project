const TIMESLOTS = ["10:00 - 12:00", "13:00 - 15:00", "16:00 - 18:00"];
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

function today() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function timeslot_bounds(date, timeslot) {
  if (typeof date !== "string" || !DATE_FORMAT.test(date) || !TIMESLOTS.includes(timeslot)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) return null;
  const [start, end] = timeslot.split(" - ");
  return {
    start: `${date} ${start}:00`,
    end: `${date} ${end}:00`,
  };
}

function utc_to_campus_datetime(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const canonical = value.replace(/(?:\.\d{1,3})?Z$/, part => part === "Z" ? ".000Z" : `${part.slice(0, -1).padEnd(4, "0")}Z`);
  if (new Date(ms).toISOString() !== canonical) return null;
  return new Date(ms + 8 * 3600000).toISOString().slice(0, 19).replace("T", " ");
}

export { TIMESLOTS, DATE_FORMAT, today, timeslot_bounds, utc_to_campus_datetime };
