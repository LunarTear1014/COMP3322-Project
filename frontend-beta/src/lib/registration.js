import { deadlineLabel, seatSummary } from './format.js'

// Derives what the event page shows and offers from the server's `eligibility`
// and `my_registration`. The server stays authoritative: every action is
// re-checked on write, and 409s are shown, not retried.
//
// kinds: join | waitlist | leave | leave_waitlist | cancel_request | join_club | admin | none
const ACTIVE = ['joined', 'pending', 'waitlisted']

export function registrationView(event) {
  const seats = seatSummary(event)
  const status = event.my_registration?.status ?? 'none'
  const position = event.my_registration?.queue_position ?? null
  const reason = event.eligibility?.reason ?? null
  const closes = event.registration_closes_at ? `Closes ${deadlineLabel(event.registration_closes_at)}` : ''
  const waiting = event.waitlisted_count > 0 ? `${event.waitlisted_count} waiting` : ''

  if (event.state === 'cancelled' || reason === 'EVENT_CANCELLED') {
    return {
      kind: 'none', chip: 'cancelled', headline: 'This event was cancelled',
      detail: ACTIVE.includes(status) || status === 'unsuccessful' ? 'Your registration was cancelled with it.' : 'No registration is needed.',
      label: 'Event cancelled', disabled: true,
    }
  }
  if (status === 'joined') {
    return { kind: 'leave', chip: 'joined', headline: 'You’re going!', detail: closes, label: 'Leave event', calendar: true }
  }
  if (status === 'pending' || status === 'waitlisted') {
    return {
      kind: 'leave_waitlist', chip: 'waitlisted', position,
      headline: position ? `You’re #${position} on the waitlist` : 'You’re on the waitlist',
      detail: 'Your place is approximate and can change. We’ll tell you if a seat opens.', label: 'Leave waitlist',
    }
  }
  if (status === 'requested') {
    return {
      kind: 'cancel_request', chip: 'requested', headline: 'Request sent',
      detail: 'The committee will accept or reject it. You can cancel until then.', label: 'Cancel request',
    }
  }
  // Venue administrators manage events and never register for them.
  if (reason === 'VENUE_ADMIN') {
    return { kind: 'admin', chip: 'admin', headline: 'Managed by venue administrators', detail: 'Venue administrators manage events and don’t register for them.', label: 'Manage event' }
  }
  if (reason === 'MEMBERSHIP_REQUIRED') {
    return { kind: 'join_club', chip: 'members_only', headline: 'Members only', detail: 'Join the club to register for this event.', label: 'Join club to register' }
  }
  if (reason === 'REGISTRATION_CLOSED') {
    return { kind: 'none', headline: 'Registration closed', detail: closes, label: 'Registration closed', disabled: true }
  }
  if (reason === 'WAITLIST_FULL') {
    return { kind: 'none', headline: 'Event and waitlist full', detail: waiting, label: 'Waitlist full', disabled: true }
  }
  if (reason === 'NOT_PUBLISHED') {
    return { kind: 'none', headline: 'Not published yet', detail: '', label: 'Not open yet', disabled: true }
  }
  // Members-only events: plain members ask, the committee decides.
  const approval = Boolean(event.eligibility?.requires_approval)
  const asks = approval ? 'Members only: the committee approves each request.' : ''
  if (event.eligibility?.can_waitlist) {
    return { kind: 'waitlist', ...(approval && { approval }), headline: 'Event full', detail: [waiting || 'Be first on the waitlist', asks, closes].filter(Boolean).join(' · '), label: approval ? 'Request a waitlist place' : 'Join waitlist' }
  }
  if (event.eligibility?.can_register) {
    return { kind: 'join', ...(approval && { approval }), headline: seats.caption, detail: [asks, closes].filter(Boolean).join(' · '), label: approval ? 'Request to join' : 'Join event' }
  }
  return { kind: 'none', headline: 'Registration unavailable', detail: '', label: 'Unavailable', disabled: true }
}

// The confirmation a toast gives after a successful registration write.
export function registrationToast(result) {
  if (result?.status === 'requested') return 'Request sent. We’ll tell you when the committee decides.'
  if (result?.status === 'waitlisted' || result?.status === 'pending') {
    return result.queue_position ? `You’re #${result.queue_position} on the waitlist.` : 'You’re on the waitlist.'
  }
  if (result?.status === 'joined') return 'You’re going! Added to My events.'
  return 'Registration updated.'
}
