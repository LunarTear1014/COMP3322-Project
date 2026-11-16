// Sorts a student's registrations into the My events tabs.
//   upcoming: joined, event not started, not cancelled
//   waitlist: waiting for a seat or for the committee to accept a
//             members-only request, event not started, not cancelled
//   past:     started, cancelled, or no longer registered (left)
// Beta providers say 'pending' for the waitlist and 'unsuccessful' for left.

export const TABS = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'waitlist', label: 'Waitlist' },
  { id: 'past', label: 'Past' },
]

const WAITING = ['pending', 'waitlisted']

export function tabFor(registration, now = new Date()) {
  const { event, status } = registration
  const over = event.state === 'cancelled' || new Date(event.start_at) <= now
  if (over) return 'past'
  if (status === 'joined') return 'upcoming'
  if (WAITING.includes(status) || status === 'requested') return 'waitlist'
  return 'past'
}

export function sortRegistrations(registrations, now = new Date()) {
  const groups = { upcoming: [], waitlist: [], past: [] }
  for (const registration of registrations) groups[tabFor(registration, now)].push(registration)
  const byStart = (a, b) => new Date(a.event.start_at) - new Date(b.event.start_at) || a.event.id - b.event.id
  groups.upcoming.sort(byStart)
  groups.waitlist.sort(byStart)
  groups.past.sort((a, b) => byStart(b, a))
  return groups
}

// The state a past or current registration shows as a chip.
export function chipFor(registration) {
  const { event, status } = registration
  if (event.state === 'cancelled') return 'cancelled'
  if (status === 'joined') return 'joined'
  if (WAITING.includes(status)) return 'waitlisted'
  if (status === 'requested') return 'requested'
  return 'left'
}
