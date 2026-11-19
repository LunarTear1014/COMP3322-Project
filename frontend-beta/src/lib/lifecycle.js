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
  const signoff = booking === 'awaiting_president'
  const publishing = event.state === 'awaiting_president'
  const reason = event.booking?.decision_reason || (booking === 'returned' ? event.signoff?.reason : undefined)
  // The venue step names where the request is right now (F03): president
  // sign-off first for committee requests, then the venue team.
  const venueLabel = rejected ? (booking === 'returned' ? 'Returned' : 'Rejected')
    : approved ? 'Approved' : signoff ? 'President sign-off' : 'Venue review'
  const steps = [
    { id: 'requested', label: 'Requested', state: 'done' },
    {
      id: 'approved',
      label: venueLabel,
      state: rejected ? 'failed' : approved ? 'done' : 'current',
      note: signoff ? 'Waiting for the president' : rejected ? reason : approved ? undefined : 'Venue team reviewing',
    },
    { id: 'publish', label: 'Publish', state: published ? 'done' : approved ? 'current' : 'upcoming', note: published ? 'Published' : publishing ? 'Waiting for the president' : 'Draft' },
    { id: 'happening', label: 'Happening', state: started && published ? 'done' : 'upcoming' },
  ]
  let next = null
  if (rejected) next = { kind: 'rerequest', label: 'Request another slot', hint: reason }
  else if (!approved) next = { kind: 'wait', hint: awaiting ? 'Waiting for the president to send this on.' : 'A venue administrator is reviewing your request. Students can’t see this event yet.' }
  // A publication request already sent waits; it never offers Publish again (F01).
  else if (publishing) next = { kind: 'wait', hint: 'Publication requested. Students can’t see it until the president publishes it.' }
  else if (!published) next = { kind: 'publish', label: 'Publish event', hint: 'Approved. Students can’t see it until it is published.' }
  return { steps, next }
}

// Organizer home groups: Needs action, Upcoming, Past.
export function groupManaged(events, now = new Date()) {
  // Cancelled events get their own group whatever their date (UX-01), so a
  // future cancellation never reads as an event that already happened.
  const groups = { needs: [], upcoming: [], past: [], cancelled: [] }
  for (const event of events) {
    const booking = event.booking?.status
    const over = new Date(event.start_at) <= now
    if (event.state === 'cancelled') groups.cancelled.push(event)
    else if (event.state === 'draft' && !over && (booking === 'confirmed' || booking === 'rejected' || booking === 'returned')) groups.needs.push(event)
    else if (over) groups.past.push(event)
    else groups.upcoming.push(event)
  }
  const asc = (a, b) => new Date(a.start_at) - new Date(b.start_at)
  groups.needs.sort(asc)
  groups.upcoming.sort(asc)
  groups.past.sort((a, b) => asc(b, a))
  groups.cancelled.sort((a, b) => asc(b, a))
  return groups
}
