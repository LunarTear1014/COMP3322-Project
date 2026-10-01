import { useState, useEffect } from 'react'
import { Link, NavLink } from 'react-router'
import '../App.css'

function VenuePage() {
  const [venues, set_venues] = useState([])
  const [load_state, set_load_state] = useState('loading')
  const [date, set_date] = useState(new Date().toISOString().slice(0, 10))
  const [selected_venue_id, set_selected_venue_id] = useState(1)
  const [selected_timeslot, set_selected_timeslot] = useState('')

  // Runs after the first render, and again whenever the date changes
  useEffect(() => {
    async function load_venues() {
      try {
        const response = await fetch(`/api/venues?date=${date}`)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        set_venues(await response.json())
        set_load_state('ready')
      } catch {
        set_load_state('error')
      }
    }
    load_venues()
  }, [date])

  const selected_venue = venues.find(
    (venue) => venue.id === selected_venue_id
  )

  if (load_state === 'error') {
    return <main><p className="message">Could not reach the server.</p></main>
  }
  if (!selected_venue) {
    return <main><p>Loading venues…</p></main>
  }

  return (
    <main>
      <header>
        <h1>ClubSpace</h1>

        <nav>
          <NavLink to="/events">Events</NavLink>
          <NavLink to="/profile">Profile</NavLink>
          <NavLink to="/venues">Venues</NavLink>
        </nav>
      </header>

      <section>
        <p>Organizer tools</p>
        <h2>Venue availability</h2>
        <p>Select a venue to view available timeslots.</p>
        <label>
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => {
              set_date(e.target.value)
              set_selected_timeslot('')
            }}
          />
        </label>
      </section>

      <section className="list">
        {venues.map((venue) => (
          <button
            className={
              venue.id === selected_venue_id
                ? 'option selected'
                : 'option'
            }
            key={venue.id}
            onClick={() => {
              set_selected_venue_id(venue.id)
              set_selected_timeslot('')
            }}
          >
            <strong>{venue.name}</strong>
            <span>{venue.location}</span>
            <span>{venue.capacity} seats</span>
          </button>
        ))}
      </section>

      <section className="panel">
        <p>Available times for</p>
        <h2>{selected_venue.name}</h2>

        <div className="list">
          {selected_venue.timeslots.map((timeslot) => (
            <button
              className={
                selected_timeslot === timeslot.time
                  ? 'option selected'
                  : 'option'
              }
              disabled={!timeslot.available}
              key={timeslot.time}
              onClick={() => set_selected_timeslot(timeslot.time)}
            >
              {timeslot.time}
              {timeslot.available ? ' · Available' : ' · Busy'}
            </button>
          ))}
        </div>

        {selected_timeslot && (
        <>
            <p className="message">
            Selected: {selected_venue.name}, {selected_timeslot}
            </p>

            <Link
            className="button-link"
            to="/bookings/new"
            state={{
                venue: selected_venue.name,
                timeslot: selected_timeslot,
                date,
            }}
            >
            Continue to booking
            </Link>
        </>
        )}      
        </section>
    </main>
  )
}

export default VenuePage
