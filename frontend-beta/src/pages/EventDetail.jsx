import { useEffect } from 'react'
import { Link, useParams } from 'react-router'
import { campusTime } from '../api'
import { Resource, Feedback } from '../components/common'
import { useResource, useAction } from '../hooks/resources'

export function EventDetail() {
  const { id } = useParams()
  const event = useResource(`/events/${id}`)
  const action = useAction(event.refresh)
  const refreshEvent = event.refresh
  useEffect(() => { window.addEventListener('focus', refreshEvent); return () => window.removeEventListener('focus', refreshEvent) }, [refreshEvent])
  const details = event.data
  const registration = details?.my_registration
  const active = ['joined', 'pending'].includes(registration?.status)
  const reasons = { MEMBERSHIP_REQUIRED: 'Join this club to register.', REGISTRATION_CLOSED: 'Registration has closed.', EVENT_CANCELLED: 'This event has been cancelled.', EVENT_FULL: 'The event is full.', WAITLIST_FULL: 'The waitlist is full.', NOT_PUBLISHED: 'This event is not published.' }
  return <main><Resource value={event}>{details && <>
    <p><Link to="/events">← All events</Link></p>
    <h1>{details.title}</h1><p>{details.club?.name} · {details.visibility === 'members_only' ? 'Members only' : 'Open to everyone'}</p>
    <div className="detail-layout"><section className="panel detail-content"><h2>About this event</h2><p>{details.description}</p><h2>When and where</h2><dl className="facts"><div><dt>Starts</dt><dd>{campusTime(details.start_at)} HKT</dd></div><div><dt>Ends</dt><dd>{campusTime(details.end_at)} HKT</dd></div><div><dt>Venue</dt><dd>{details.venue?.name}</dd></div></dl></section>
      <aside className="panel registration-panel"><h2>Registration</h2><p><strong>{details.joined_count} of {details.capacity} places filled</strong><br/>{details.waitlisted_count} on the waitlist</p>{details.registration_closes_at && <p>Closes {campusTime(details.registration_closes_at)} HKT</p>}<p>{registration?.status === 'none' ? 'You have not registered.' : `Your registration: ${registration?.status?.replaceAll('_', ' ')}`}{registration?.queue_position != null && ` · Approximate position ${registration.queue_position}`}</p>
      {details.eligibility?.reason && reasons[details.eligibility.reason] && <p>{reasons[details.eligibility.reason]} {details.eligibility.reason === 'MEMBERSHIP_REQUIRED' && <Link to="/profile">View clubs</Link>}</p>}<Feedback action={action}/>
      {active ? <button disabled={action.busy} onClick={() => action.run(`/events/${id}/registration`, 'DELETE', {}, 'Registration updated.')}>Leave {registration.status === 'pending' ? 'waitlist' : 'event'}</button> : <button disabled={action.busy || !(details.eligibility?.can_register || details.eligibility?.can_waitlist)} onClick={() => action.run(`/events/${id}/registration`, 'POST', { allow_waitlist: !!details.eligibility.can_waitlist }, 'Registration updated.')}>{details.eligibility?.can_waitlist ? 'Join waitlist' : 'Join event'}</button>}</aside></div>
  </>}</Resource></main>
}
