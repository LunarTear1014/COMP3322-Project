import { useState } from 'react'
import { Link } from 'react-router'
import { query, campusTime, campusInstant, addDays } from '../api'
import { PageHeading, ErrorNotice, Resource, Pagination } from '../components/common'
import { useResource, useAllOptions } from '../hooks/resources'

export function Events() {
  const [q, setQ] = useState('')
  const [phase, setPhase] = useState('upcoming')
  const [club, setClub] = useState('')
  const [venue, setVenue] = useState('')
  const [visibility, setVisibility] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [page, setPage] = useState(1)
  const clubs = useAllOptions('/clubs')
  const venues = useAllOptions('/venues')
  const from = fromDate && toDate ? campusInstant(fromDate, '00:00') : ''
  const to = fromDate && toDate ? campusInstant(addDays(toDate, 1), '00:00') : ''
  const invalidRange = Boolean(fromDate || toDate) && (!from || !to || new Date(to) <= new Date(from) || new Date(to) - new Date(from) > 93 * 86400000)
  const r = useResource(invalidRange ? null : `/events${query({q, phase, club_id:club, venue_id:venue, visibility, from, to, page})}`)
  const change = setter => event => { setter(event.target.value); setPage(1) }
  return <main><PageHeading title="Find your next event." description="Explore what’s happening across campus."/>
    <div className="filters">
      <label>Search<input value={q} maxLength={100} onChange={change(setQ)}/></label>
      <label>When<select value={phase} onChange={change(setPhase)}><option value="upcoming">Upcoming</option><option value="past">Past</option></select></label>
      <label>Club<select value={club} onChange={change(setClub)}><option value="">All clubs</option>{clubs.data?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Venue<select value={venue} onChange={change(setVenue)}><option value="">All venues</option>{venues.data?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Visibility<select value={visibility} onChange={change(setVisibility)}><option value="">All</option><option value="public">Public</option><option value="members_only">Members only</option></select></label>
      <label>From date<input type="date" value={fromDate} onChange={change(setFromDate)}/></label>
      <label>Through date<input type="date" value={toDate} onChange={change(setToDate)}/></label>
    </div>
    <ErrorNotice error={clubs.error}/><ErrorNotice error={venues.error}/>
    {invalidRange ? <p role="alert">Choose both dates in order, spanning no more than 93 days.</p> : <Resource value={r} empty="No events match these filters."><div className="grid">{r.data?.map(event => <EventCard key={event.id} event={event}/>)}</div><Pagination meta={r.meta} page={page} setPage={setPage}/></Resource>}
  </main>
}
export function EventCard({ event }) {
  return <article className="panel event-card">
    <p className="event-date">{campusTime(event.start_at)} HKT</p>
    <h2><Link to={`/events/${event.id}`}>{event.title}</Link></h2>
    <p>{event.club?.name} · {event.venue?.name}</p>
    <p>{event.visibility === 'members_only' ? 'Members only' : 'Open to everyone'} · {event.joined_count} of {event.capacity} places filled{event.waitlisted_count > 0 && ` · ${event.waitlisted_count} waiting`}</p>
  </article>
}
