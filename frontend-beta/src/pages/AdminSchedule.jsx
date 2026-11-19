import { Link, useSearchParams } from 'react-router'
import { addDays, campusDate, campusInstant, query, weekStart } from '../api'
import { PageHeading, Resource } from '../components/common'
import { AdminTabs } from '../components/nav/AdminTabs'
import { EmptyState, StatusChip } from '../components/ui'
import { useAllOptions, useResource } from '../hooks/resources'
import { clubColour } from '../lib/club'
import { dayLabel, timeRange } from '../lib/format'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const range = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', day: 'numeric', month: 'short', year: 'numeric' })

function Booking({ item }) {
  const { event, venue, club } = item
  const over = event && event.capacity > venue.capacity
  return (
    <li className="schedule-item" style={{ '--club': clubColour(club.id).cssVar }}>
      <span className="schedule-time">{timeRange(item.start_at, item.end_at)}</span>
      <div className="schedule-body">
        <p className="schedule-title">
          {event?.state === 'published' ? <Link to={`/events/${event.id}`}>{event.title}</Link> : (event?.title ?? 'Reserved')}
        </p>
        <p className="cs-meta">
          <Link to={`/venues/${venue.id}/calendar`}>{venue.name}</Link> · {club.name}
        </p>
        {event && (
          <div className="schedule-facts">
            <StatusChip state={event.state} />
            {event.visibility === 'members_only' && <StatusChip state="members_only" />}
            <span className="cs-meta">
              {event.joined_count} of {event.capacity} joined{event.waitlisted_count > 0 && ` · ${event.waitlisted_count} waiting`}
            </span>
            {over && <span className="cs-chip cs-chip-hot">Over venue capacity ({venue.capacity})</span>}
          </div>
        )}
      </div>
    </li>
  )
}

// A venue administrator's week across every venue: approved bookings in time
// order, grouped by Hong Kong day. Pending requests stay on Booking review.
export function AdminSchedule({ session }) {
  const [params, setParams] = useSearchParams()
  const today = campusDate(new Date())
  const week = weekStart(DATE.test(params.get('week') ?? '') ? params.get('week') : today)
  const venueId = params.get('venue_id') ?? ''
  const venues = useAllOptions('/venues')
  const admin = session.user.platform_role === 'venue_admin'
  const schedule = useResource(admin
    ? `/admin/schedule${query({ from: campusInstant(week), to: campusInstant(addDays(week, 7)), venue_id: venueId })}`
    : null)

  const set = changes => {
    const next = new URLSearchParams(params)
    Object.entries(changes).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key))
    setParams(next, { replace: true })
  }
  const toWeek = date => set({ week: weekStart(date) === weekStart(today) ? '' : weekStart(date) })

  if (!admin) {
    return <main className="page"><PageHeading title="Venue schedule" /><EmptyState title="Only venue administrators can see the schedule" /></main>
  }

  const bookings = schedule.data?.bookings ?? []
  const days = Array.from({ length: 7 }, (_, index) => addDays(week, index))
    .map(date => ({ date, items: bookings.filter(item => campusDate(new Date(item.start_at)) === date) }))
    .filter(day => day.items.length)
  const venueCount = new Set(bookings.map(item => item.venue.id)).size
  const pending = schedule.data?.pending_requests ?? 0

  return (
    <main className="page">
      <AdminTabs />
      <PageHeading title="Venue schedule" description="Approved bookings across every venue · Hong Kong time." />
      <div className="schedule-toolbar">
        <h2 className="section-title" aria-live="polite">
          {range.formatRange(new Date(campusInstant(week)), new Date(campusInstant(addDays(week, 6))))}
        </h2>
        <div className="calendar-week-controls" role="group" aria-label="Week navigation">
          <button type="button" className="secondary-button" onClick={() => toWeek(addDays(week, -7))}>Previous week</button>
          <button type="button" className="secondary-button" onClick={() => toWeek(today)}>This week</button>
          <button type="button" className="secondary-button" onClick={() => toWeek(addDays(week, 7))}>Next week</button>
        </div>
        <label className="schedule-filter">Venue
          <select className="cs-input" value={venueId} onChange={event => set({ venue_id: event.target.value })}>
            <option value="">All venues</option>
            {venues.data?.map(venue => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
          </select>
        </label>
      </div>
      <Resource value={schedule} allowEmpty>
        <p className="cs-meta schedule-summary">
          {bookings.length} {bookings.length === 1 ? 'booking' : 'bookings'}
          {!venueId && ` across ${venueCount} ${venueCount === 1 ? 'venue' : 'venues'}`}
          {pending > 0 && <> · <Link to="/admin/bookings">{pending} pending {pending === 1 ? 'request' : 'requests'} to review</Link></>}
        </p>
        {days.length ? days.map(day => (
          <section key={day.date} className="schedule-day" aria-labelledby={`day-${day.date}`}>
            <h3 id={`day-${day.date}`} className="schedule-day-title">
              {dayLabel(campusInstant(day.date, '12:00'))}{day.date === today && <span className="calendar-today">Today</span>}
            </h3>
            <ol className="schedule-list">{day.items.map(item => <Booking key={item.booking_id} item={item} />)}</ol>
          </section>
        )) : <EmptyState title="Nothing booked this week">Approved bookings will show up here.</EmptyState>}
      </Resource>
    </main>
  )
}
