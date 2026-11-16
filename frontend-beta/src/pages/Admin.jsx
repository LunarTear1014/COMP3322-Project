import { useState } from 'react'
import { addDays, campusDate, campusInstant, query } from '../api'
import { ErrorNotice, PageHeading, Pagination, Resource } from '../components/common'
import { BottomSheet, Button, EmptyState, StatusChip, TextField, useToast } from '../components/ui'
import { useAction, useAllOptions, useResource } from '../hooks/resources'
import { timeLine } from '../lib/format'
import { isOrganizer } from '../lib/roles'

function waiting(since, now = Date.now()) {
  const hours = Math.max(0, Math.floor((now - new Date(since).getTime()) / 3600000))
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`
}

// What else is booked at this venue on the request's campus day.
function VenueDay({ booking, venueName }) {
  const day = campusDate(new Date(booking.start_at))
  const calendar = useResource(`/venues/${booking.venue_id}/calendar${query({ from: campusInstant(day, '00:00'), to: campusInstant(addDays(day, 1), '00:00') })}`)
  const others = calendar.data?.bookings ?? []
  return (
    <section aria-label={`${venueName} on this day`}>
      <h3 className="review-subtitle">{venueName} that day</h3>
      <Resource value={calendar} allowEmpty>
        {others.length ? (
          <ul className="stack-list">{others.map((item, index) => <li key={index} className="cs-meta">{timeLine(item.start_at, item.end_at)} · {item.title || 'Reserved'}</li>)}</ul>
        ) : <p className="cs-meta">Nothing else is booked.</p>}
      </Resource>
    </section>
  )
}

// A venue administrator's queue. Flat admin surface: a table that opens a
// review panel per row. Approval does not publish the event.
export function Admin({ session }) {
  const clubs = useAllOptions('/clubs')
  const venues = useAllOptions('/venues')
  const [page, setPage] = useState(1)
  const requests = useResource(`/bookings${query({ status: 'pending', page })}`)
  const [openId, setOpenId] = useState(null)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const toast = useToast()
  const action = useAction(requests.refresh)
  const own = new Set(session.memberships.filter(isOrganizer).map(item => item.club_id))

  const booking = requests.data?.find(item => item.id === openId)
  const clubName = id => clubs.data?.find(club => club.id === id)?.name || `Club ${id}`
  const venue = id => venues.data?.find(item => item.id === id)
  const close = () => { setOpenId(null); setRejecting(false); setReason('') }

  async function decide(decision) {
    const body = { expected_version: booking.version, decision, ...(reason.trim() ? { reason: reason.trim() } : {}) }
    const result = await action.run(`/bookings/${booking.id}/decision`, 'POST', body)
    if (result) {
      toast.show({ message: decision === 'approve' ? 'Booking approved. The event stays a draft until the club publishes it.' : 'Booking rejected.' })
      close()
    }
  }

  const blocked = booking && (booking.expired || own.has(booking.club_id))
  const capacityOver = booking && booking.capacity && venue(booking.venue_id) && booking.capacity > venue(booking.venue_id).capacity

  return (
    <main className="page">
      <PageHeading title="Booking review" description="Approval does not publish the event. Availability is checked again when you decide." />
      <h2 className="section-title">Pending requests {requests.meta && `(${requests.meta.total})`}</h2>
      {!openId && <ErrorNotice error={action.error} />}
      <Resource
        value={requests}
        empty={<EmptyState title="No requests waiting">You’re all caught up.</EmptyState>}
      >
        <div className="cs-tablewrap" role="region" aria-label="Pending requests" tabIndex={0}>
          <table className="cs-table">
            <thead><tr><th>Event</th><th>Club</th><th>Venue</th><th>Slot (Hong Kong time)</th><th>Waiting</th><th>Status</th><th><span className="cs-sr">Action</span></th></tr></thead>
            <tbody>
              {requests.data?.map(item => (
                <tr key={item.id}>
                  <td>{item.event_title}</td>
                  <td>{clubName(item.club_id)}</td>
                  <td>{venue(item.venue_id)?.name || `Venue ${item.venue_id}`}</td>
                  <td>{timeLine(item.start_at, item.end_at)}</td>
                  <td>{item.created_at ? waiting(item.created_at) : '—'}</td>
                  <td>{item.expired ? <span className="cs-chip cs-chip-neutral">Expired</span> : <StatusChip state="pending" />}</td>
                  <td><Button disabled={item.expired} aria-label={`Review ${item.event_title}`} onClick={() => { setOpenId(item.id); setRejecting(false); setReason('') }}>{item.expired ? 'Expired' : 'Review'}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination meta={requests.meta} page={page} setPage={setPage} />
      </Resource>

      <BottomSheet
        open={Boolean(booking)}
        title="Review request"
        onClose={close}
        footer={booking && (rejecting ? (
          <>
            <Button onClick={() => setRejecting(false)}>Back</Button>
            <Button variant="danger" busy={action.busy} disabled={blocked || !reason.trim()} onClick={() => decide('reject')}>Reject request</Button>
          </>
        ) : (
          <>
            <Button disabled={blocked} onClick={() => setRejecting(true)}>Reject</Button>
            <Button variant="primary" busy={action.busy} disabled={blocked} onClick={() => decide('approve')}>Approve</Button>
          </>
        ))}
      >
        {booking && (
          <>
            <h3 className="review-subtitle">{booking.event_title}</h3>
            <p className="cs-meta">{clubName(booking.club_id)} · {venue(booking.venue_id)?.name} · {timeLine(booking.start_at, booking.end_at)} Hong Kong time</p>
            {venue(booking.venue_id) && (
              <p className={capacityOver ? 'cs-error' : 'cs-meta'}>
                {booking.capacity ? `Capacity ${booking.capacity} of ${venue(booking.venue_id).capacity} seats${capacityOver ? ': over the venue limit' : ''}.` : `Venue holds ${venue(booking.venue_id).capacity} people.`}
              </p>
            )}
            {own.has(booking.club_id) && <p className="notice notice-info">You can’t review your own club’s request.</p>}
            <VenueDay booking={booking} venueName={venue(booking.venue_id)?.name || 'Venue'} />
            <ErrorNotice error={action.error} />
            {rejecting && (
              <TextField as="textarea" label="Reason for rejecting" hint="The club sees this reason. Required." maxLength={500} rows={3} value={reason} onChange={event => setReason(event.target.value)} />
            )}
          </>
        )}
      </BottomSheet>
    </main>
  )
}
