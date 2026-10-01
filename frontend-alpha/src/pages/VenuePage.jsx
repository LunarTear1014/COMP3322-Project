import { useState } from 'react'
import { Link, NavLink } from 'react-router'
import '../App.css'

const mock_venues = [
  {
    id: 1,
    name: 'Happy Park Hall',
    location: 'Main Campus',
    capacity: 80,
    timeslots: [
      { time: '10:00 - 12:00', available: true },
      { time: '13:00 - 15:00', available: false },
      { time: '16:00 - 18:00', available: true },
    ],
  },
  {
    id: 2,
    name: 'Student Union Room 301',
    location: 'Student Union',
    capacity: 35,
    timeslots: [
      { time: '10:00 - 12:00', available: false },
      { time: '13:00 - 15:00', available: true },
      { time: '16:00 - 18:00', available: true },
    ],
  },
  {
    id: 3,
    name: 'GoldenScene Cinema',
    location: 'Arts Building',
    capacity: 120,
    timeslots: [
      { time: '10:00 - 12:00', available: true },
      { time: '13:00 - 15:00', available: true },
      { time: '16:00 - 18:00', available: false },
    ],
  },
]

function VenuePage() {
  const [selected_venue_id, set_selected_venue_id] = useState(1)
  const [selected_timeslot, set_selected_timeslot] = useState('')

  const selected_venue = mock_venues.find(
    (venue) => venue.id === selected_venue_id
  )

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
      </section>

      <section className="list">
        {mock_venues.map((venue) => (
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
