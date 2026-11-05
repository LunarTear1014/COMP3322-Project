export class ApiError extends Error {
  constructor(message, status, code, fields = {}, retryAfter = null) { super(message); this.status = status; this.code = code; this.fields = fields; this.retryAfter = retryAfter }
}

export function query(values) { const params = new URLSearchParams(); Object.entries(values).forEach(([key, value]) => { if (value !== '' && value != null) params.set(key, value) }); const s = params.toString(); return s ? `?${s}` : '' }
export const campusTime = value => value ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'
export const campusDate = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
export const campusInstant = (date, time = '00:00') => new Date(`${date}T${time}:00+08:00`).toISOString()
export function addDays(date, days) { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10) }
export function weekStart(date) { const day = new Date(`${date}T00:00:00Z`).getUTCDay(); return addDays(date, -((day + 6) % 7)) }
export function overlaps(a, b, start, end) { return new Date(a) < new Date(end) && new Date(b) > new Date(start) }

// Treat intervals as half-open so adjacent bookings remain available.
export function slotAvailability(start, end, bookings, now = new Date()) {
  if (new Date(start) <= now) return { status: 'past', bookings: [] }
  const conflicts = bookings.filter(booking => booking.busy && overlaps(booking.start_at, booking.end_at, start, end))
  return { status: conflicts.length ? 'busy' : 'available', bookings: conflicts }
}
