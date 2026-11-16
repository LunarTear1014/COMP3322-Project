import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { query, campusDate, campusInstant, addDays, weekStart, slotAvailability } from '../api'
import { PageHeading, Resource } from '../components/common'
import { useResource, useAllOptions } from '../hooks/resources'

export const calendarWeekday = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'Asia/Hong_Kong' })
export const calendarDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Hong_Kong' })
export const calendarRange = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Hong_Kong' })
export function CalendarSlot({ date, label, slot, bookings, venueId, canBook }) {
  const availability = slotAvailability(campusInstant(date, slot.start), campusInstant(date, slot.end), bookings)
  if (availability.status === 'past') return <span className="calendar-slot is-past">Past</span>
  if (availability.status === 'busy') {
    const titles = availability.bookings.map(booking => booking.title).filter(Boolean)
    return <div className="calendar-slot is-reserved">
      <strong>Reserved</strong>
      {titles.length > 0 && <small>{titles.join(', ')}</small>}
    </div>
  }
  if (!canBook) return <span className="calendar-slot is-available">Available</span>
  return <Link
    className="calendar-slot is-available"
    to={`/bookings/new${query({ venue_id: venueId, date, slot_id: slot.id })}`}
    aria-label={`Available, select ${label}, ${slot.start} to ${slot.end}`}
  >Available</Link>
}
export function Calendar({ canBook }) {
  const { id } = useParams()
  const [today, setToday] = useState(() => campusDate(new Date()))
  const [day, setDay] = useState(today)
  const week = weekStart(day)
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(week, index)
    const instant = new Date(campusInstant(date))
    return { date, weekday: calendarWeekday.format(instant), shortDate: calendarDate.format(instant), instant }
  })
  const config = useResource('/config')
  const venues = useAllOptions('/venues')
  const calendar = useResource(`/venues/${id}/calendar${query({ from: campusInstant(week), to: campusInstant(addDays(week, 7)) })}`)
  const showBookingLinks = true
  const venueName = venues.data?.find(venue => String(venue.id) === id)?.name || 'Venue'
  const dayClass = date => `calendar-day${date === day ? ' is-selected' : ''}${date === today ? ' is-today' : ''}`
  function navigateWeek(offset) {
    const currentDate = campusDate(new Date())
    setToday(currentDate)
    setDay(selected => offset === 0 ? currentDate : addDays(selected, offset))
  }

  return <main>
    <p><Link to="/venues">← All venues</Link></p>
    <PageHeading title={`${venueName} calendar`} description="Hong Kong time · Pending requests do not reserve slots."/>
    <section className="calendar-layout" aria-label="Venue availability">
      <div className="calendar-toolbar">
        <h2 aria-live="polite">{calendarRange.formatRange(days[0].instant, days[6].instant)}</h2>
        <div className="calendar-week-controls" role="group" aria-label="Week navigation">
          <button className="secondary-button" onClick={() => navigateWeek(-7)}>Previous week</button>
          <button className="secondary-button" onClick={() => navigateWeek(0)}>Today</button>
          <button className="secondary-button" onClick={() => navigateWeek(7)}>Next week</button>
        </div>
      </div>
      <label className="calendar-day-selector">Choose a day
        <select value={day} onChange={event => setDay(event.target.value)}>
          {days.map(({ date, weekday, shortDate }) => <option key={date} value={date}>
            {weekday}, {shortDate}{date === today ? ' (Today)' : ''}
          </option>)}
        </select>
      </label>
      {showBookingLinks && <p className="calendar-hint">Select an available time to start a booking.</p>}
      <Resource value={config}><Resource value={calendar}>
        <table className="venue-calendar" aria-label={`${venueName} time slots`}>
          <thead><tr>
            <th className="calendar-time" scope="col">Time</th>
            {days.map(({ date, weekday, shortDate }) => <th className={dayClass(date)} key={date} scope="col">
              <time dateTime={date} aria-current={date === today ? 'date' : undefined}>
                <span className="calendar-weekday">{weekday}{date === today && <span className="calendar-today">Today</span>}</span>
                <span className="calendar-date">{shortDate}</span>
              </time>
            </th>)}
          </tr></thead>
          <tbody>{calendar.data && config.data?.slots.map(slot => <tr key={slot.id}>
            <th className="calendar-time" scope="row">{slot.start}–{slot.end}</th>
            {days.map(({ date, weekday, shortDate }) => <td className={dayClass(date)} key={date}>
              <CalendarSlot date={date} label={`${weekday} ${shortDate}`} slot={slot} bookings={calendar.data.bookings} venueId={id} canBook={showBookingLinks}/>
            </td>)}
          </tr>)}</tbody>
        </table>
      </Resource></Resource>
    </section>
  </main>
}
