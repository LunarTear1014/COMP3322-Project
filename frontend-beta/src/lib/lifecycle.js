// Where an event is between request and the day itself. Steps come from the
// booking status and event state, never from dates alone.
// step.state: done | current | upcoming | failed

export function lifecycle(event, now = new Date()) {
  if (event.state === 'cancelled') return null
  const booking = event.booking?.status
  const published = event.state === 'published'
  const started = new Date(event.start_at) <= now
  const awaiting = event.state === 'awaiting_president' || booking === 'awaiting_president'
  const rejected = booking === 'rejected' || booking === 'returned'

  const approved = published || booking === 'confirmed'
  const steps = [
    { id: 'requested', label: 'Requested', state: 'done' },
    {
      id: 'approved',
      label: rejected ? (booking === 'returned' ? 'Returned' : 'Rejected') : 'Approved',
      state: rejected ? 'failed' : approved ? 'done' : 'current',
      note: awaiting ? 'Waiting for the president' : rejected ? event.booking?.decision_reason : undefined,
    },
    { id: 'publish', label: 'Publish', state: published ? 'done' : approved ? 'current' : 'upcoming', note: published ? 'Published' : 'Draft' },
    { id: 'happening', label: 'Happening', state: started && published ? 'done' : 'upcoming' },
  ]
  let next = null
  if (rejected) next = { kind: 'rerequest', label: 'Request another slot', hint: event.booking?.decision_reason }
  else if (!approved) next = { kind: 'wait', hint: awaiting ? 'Waiting for the president to send this on.' : 'A venue administrator is reviewing your request. Students can’t see this event yet.' }
  else if (!published) next = { kind: 'publish', label: 'Publish event', hint: 'Approved. Students can’t see it until you publish.' }
  return { steps, next }
}

// Organizer home groups: Needs action, Upcoming, Past.
export function groupManaged(events, now = new Date()) {
  const groups = { needs: [], upcoming: [], past: [] }
  for (const event of events) {
    const booking = event.booking?.status
    const over = new Date(event.start_at) <= now || event.state === 'cancelled'
    if (event.state === 'draft' && !over && (booking === 'confirmed' || booking === 'rejected' || booking === 'returned')) groups.needs.push(event)
    else if (over) groups.past.push(event)
    else groups.upcoming.push(event)
  }
  const asc = (a, b) => new Date(a.start_at) - new Date(b.start_at)
  groups.needs.sort(asc)
  groups.upcoming.sort(asc)
  groups.past.sort((a, b) => asc(b, a))
  return groups
}
