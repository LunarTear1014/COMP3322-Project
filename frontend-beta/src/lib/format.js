// Date and time presentation in campus time (Asia/Hong_Kong). Always built with
// Intl so browser time zones never leak in; state "Hong Kong time" once per page.
const zone = { timeZone: 'Asia/Hong_Kong' }
const parts = (options, date) => Object.fromEntries(
  new Intl.DateTimeFormat('en-HK', { ...zone, ...options, hourCycle: 'h23' }).formatToParts(date).map(part => [part.type, part.value]),
)

const clock = date => {
  const p = parts({ hour: '2-digit', minute: '2-digit' }, date)
  return `${p.hour}:${p.minute}`
}

// "Fri 20 Nov"
export function dayLabel(instant) {
  const p = parts({ weekday: 'short', day: 'numeric', month: 'short' }, new Date(instant))
  return `${p.weekday} ${p.day} ${p.month}`
}

// "Fri 20 Nov · 13:00–15:00"
export function timeLine(startAt, endAt) {
  const start = new Date(startAt)
  return `${dayLabel(start)} · ${clock(start)}${endAt ? `–${clock(new Date(endAt))}` : ''}`
}

// "1 Sept 2025" (en-HK month abbreviations, as elsewhere in the app)
export function dateLabel(instant) {
  const p = parts({ day: 'numeric', month: 'short', year: 'numeric' }, new Date(instant))
  return `${p.day} ${p.month} ${p.year}`
}

// "13:00–15:00"
export function timeRange(startAt, endAt) {
  return `${clock(new Date(startAt))}–${clock(new Date(endAt))}`
}

// { month: 'NOV', day: '20', iso: '2026-11-20T13:00+08:00' } for the date tile.
export function dateTile(instant) {
  const date = new Date(instant)
  const p = parts({ month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }, date)
  const month = new Intl.DateTimeFormat('en-HK', { ...zone, month: '2-digit' }).format(date)
  return {
    month: p.month.toUpperCase(),
    day: p.day,
    iso: `${p.year}-${month}-${p.day}T${p.hour}:${p.minute}+08:00`,
  }
}

// "Closes Thu 19 Nov, 14:00"
export function deadlineLabel(instant) {
  const date = new Date(instant)
  return `${dayLabel(date)}, ${clock(date)}`
}

// Concrete seat language: "12 spots left", "Full", "4 waiting".
export function seatSummary(event) {
  const left = Math.max(0, event.capacity - event.joined_count)
  return {
    left,
    joined: `${event.joined_count} of ${event.capacity} joined`,
    caption: left === 0 ? (event.waitlisted_count ? `${event.waitlisted_count} waiting` : 'Full') : `${left} ${left === 1 ? 'spot' : 'spots'} left`,
    ratio: event.capacity ? Math.min(1, event.joined_count / event.capacity) : 0,
  }
}
