import { addDays, campusInstant, slotAvailability, weekStart } from '../apiShared.js'

// Slot picker data: one week of campus days, each with the configured slots in
// one of four states. Availability uses full UTC intervals, so legacy bookings
// that cross midnight still block the slots they overlap.

const long = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Hong_Kong' })
const short = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'Asia/Hong_Kong' })
const dayNumber = new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'Asia/Hong_Kong' })
const rangeDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'Asia/Hong_Kong' })
const rangeEnd = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Hong_Kong' })

export { weekStart }

// Monday-start week containing `date` (YYYY-MM-DD), as the API range [from, to).
export function weekWindow(date) {
  const start = weekStart(date)
  return { start, from: campusInstant(start, '00:00'), to: campusInstant(addDays(start, 7), '00:00') }
}

// "9-15 Nov"
export function weekLabel(start) {
  return `${rangeDay.format(new Date(campusInstant(start)))}–${rangeEnd.format(new Date(campusInstant(addDays(start, 6))))}`
}

export function buildWeek(start, slots, bookings, now = new Date()) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(start, index)
    const instant = new Date(campusInstant(date))
    const entries = slots.map(slot => {
      const availability = slotAvailability(campusInstant(date, slot.start), campusInstant(date, slot.end), bookings, now)
      const holders = availability.bookings.map(booking => booking.title).filter(Boolean)
      return {
        slot,
        status: availability.status === 'busy' ? 'booked' : availability.status,
        holder: availability.status === 'busy' ? (holders.join(', ') || 'Reserved') : null,
      }
    })
    return {
      date,
      weekday: short.format(instant),
      number: dayNumber.format(instant),
      label: long.format(instant),
      slots: entries,
      past: entries.every(entry => entry.status === 'past'),
      free: entries.filter(entry => entry.status === 'available').length,
    }
  })
}

// The first day in the week that still has an available slot, else today's/first day.
export function defaultDay(days) {
  return days.find(day => day.free > 0)?.date ?? days[0].date
}

export function slotLabel(slot) {
  return `${slot.start}–${slot.end}`
}
