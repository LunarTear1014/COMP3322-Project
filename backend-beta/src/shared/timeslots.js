const TIMESLOTS = ["10:00 - 12:00", "13:00 - 15:00", "16:00 - 18:00"];
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function timeslot_bounds(date, timeslot) {
  if (!TIMESLOTS.includes(timeslot)) return null;
  const [start, end] = timeslot.split(" - ");
  return {
    start: `${date} ${start}:00`,
    end: `${date} ${end}:00`,
  };
}

export { TIMESLOTS, DATE_FORMAT, today, timeslot_bounds };
