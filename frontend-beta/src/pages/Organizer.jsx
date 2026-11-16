import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { PageHeading, Resource } from '../components/common'
import { SignoffQueue } from '../components/SignoffQueue'
import { EventCard } from '../components/EventCard'
import { ButtonLink, EmptyState, StatusChip } from '../components/ui'
import { useAllOptions } from '../hooks/resources'
import { anyEventIn, useLiveSignal } from '../hooks/useLiveSignal'
import { groupManaged } from '../lib/lifecycle'
import { isOrganizer } from '../lib/roles'

const NEEDS_HINT = {
  confirmed: 'Approved. Publish it so students can join.',
  awaiting_president: 'Waiting for the president.',
  rejected: 'Rejected. Request another slot.',
  returned: 'Returned by the president.',
}

function Group({ id, title, events, empty }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="section-title">{title} <span className="cs-meta cs-nums">({events.length})</span></h2>
      {events.length ? (
        <div className="card-grid">
          {events.map(event => (
            <div key={event.id} className="managed-item">
              <EventCard flat event={event} chip={<><StatusChip state={event.state} /><StatusChip state={event.booking?.status} /></>} />
              {NEEDS_HINT[event.booking?.status] && event.state === 'draft' && <p className="cs-meta">{NEEDS_HINT[event.booking.status]}</p>}
              <Link className="managed-link" to={`/organizer/events/${event.id}`}>Manage {event.title}</Link>
            </div>
          ))}
        </div>
      ) : <p className="cs-meta">{empty}</p>}
    </section>
  )
}

// Organizer home: what needs you first. Flat cards, one primary action.
export function Organizer({ session }) {
  const [club, setClub] = useState('')
  const events = useAllOptions('/me/events')
  // Approvals, sign-offs and seat counts on managed events update live.
  const managed = useMemo(() => new Set((events.data ?? []).map(event => event.id)), [events.data])
  useLiveSignal(anyEventIn(managed), events.refresh, { wait: 1500 })
  const committeeClubs = session.memberships.filter(isOrganizer)
  const president = session.memberships.some(item => item.role === 'president')
  const groups = groupManaged((events.data || []).filter(event => !club || String(event.club?.id) === club))
  return (
    <main className="page">
      <PageHeading title="Organizer" description="Manage your club events and requests." />
      <div className="cs-row organizer-tools">
        <ButtonLink variant="primary" to="/bookings/new">Request a venue and create a draft</ButtonLink>
        <ButtonLink to="/organizer/clubs">Club members and reports</ButtonLink>
      </div>
      <div className="cs-field organizer-club">
        <label htmlFor="organizer-club">Club</label>
        <select id="organizer-club" className="cs-input" value={club} onChange={event => setClub(event.target.value)}>
          <option value="">All committee clubs</option>
          {committeeClubs.map(item => <option key={item.club_id} value={item.club_id}>{item.club_name}</option>)}
        </select>
      </div>
      <ul className="cs-row role-chips" aria-label="Your roles">{committeeClubs.map(item => <li key={item.club_id}><span className="cs-chip cs-chip-neutral">{item.club_name}: {item.role === 'president' ? 'President' : 'Committee'}</span></li>)}</ul>
      <p>Reports: {committeeClubs.map(item => <span key={item.club_id}><Link to={`/organizer/clubs/${item.club_id}/reports`}>{item.club_name}</Link> </span>)}</p>
      {president && <SignoffQueue onChange={events.refresh} />}
      <Resource value={events} allowEmpty>
        {events.data?.length === 0 ? (
          <EmptyState title="No managed events yet" actions={<ButtonLink variant="primary" to="/bookings/new">Request a venue</ButtonLink>}>Request a venue to create your first event.</EmptyState>
        ) : (
          <>
            <Group id="needs-action" title="Needs action" events={groups.needs} empty="Nothing waiting on you." />
            <Group id="upcoming" title="Upcoming" events={groups.upcoming} empty="No upcoming events." />
            <Group id="past" title="Past" events={groups.past} empty="No past events." />
          </>
        )}
      </Resource>
    </main>
  )
}
