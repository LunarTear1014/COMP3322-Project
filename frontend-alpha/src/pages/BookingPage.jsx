import { useState } from 'react'
import { NavLink, useLocation } from 'react-router'
import '../App.css'

const venue_options = [
  'Lok Yew Hall',
  'Main Building Room 230',
  'GoldenScene Cinema',
]

const timeslot_options = [
  '10:00 - 12:00',
  '13:00 - 15:00',
  '16:00 - 18:00',
]

function BookingPage() {
  const location = useLocation()

  const [form, set_form] = useState({
    club: 'Photography Society',
    title: '',
    description: '',
    date: location.state?.date || '',
    venue: location.state?.venue || '',
    timeslot: location.state?.timeslot || '',
    visibility: 'Public',
  })

  const [poster_name, set_poster_name] = useState('')
  const [success_message, set_success_message] = useState('')

  function handle_change(event) {
    set_form({
      ...form,
      [event.target.name]: event.target.value,
    })
  }

  async function handle_submit(event) {
    event.preventDefault()

    if (!form.venue || !form.timeslot) {
      set_success_message('Please select a venue and timeslot.')
      return
    }

    try {
      const response = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),   // form already has exactly the fields the server wants
      })
      const data = await response.json()

      if (!response.ok) {
        set_success_message(data.message)   // e.g. "Lok Yew Hall is already booked on ..."
        return
      }
      set_success_message(
        `${data.title} has been created and the venue booking is confirmed.`
      )
    } catch {
      set_success_message('Could not reach the server.')
    }
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

      <section className="panel">
        <p>Organizer tools</p>
        <h2>Book venue and create event</h2>

        <form onSubmit={handle_submit}>
          <label>
            Club
            <select name="club" value={form.club} onChange={handle_change}>
              <option>Photography Society</option>
              <option>Film Society</option>
              <option>Debate Club</option>
            </select>
          </label>

          <label>
            Event title
            <input
              required
              name="title"
              value={form.title}
              onChange={handle_change}
              placeholder="e.g. Night Photography Walk"
            />
          </label>

          <label>
            Event description
            <textarea
              required
              name="description"
              value={form.description}
              onChange={handle_change}
              placeholder="Describe the event for students."
            />
          </label>

          <label>
            Event date
            <input
              required
              type="date"
              name="date"
              value={form.date}
              onChange={handle_change}
            />
          </label>

          <label>
            Venue
            <select
              required
              name="venue"
              value={form.venue}
              onChange={handle_change}
            >
              <option value="">Choose a venue</option>
              {venue_options.map((venue) => (
                <option key={venue}>{venue}</option>
              ))}
            </select>
          </label>

          <label>
            Timeslot
            <select
              required
              name="timeslot"
              value={form.timeslot}
              onChange={handle_change}
            >
              <option value="">Choose a timeslot</option>
              {timeslot_options.map((timeslot) => (
                <option key={timeslot}>{timeslot}</option>
              ))}
            </select>
          </label>

          <label>
            Event visibility
            <select
              name="visibility"
              value={form.visibility}
              onChange={handle_change}
            >
              <option>Public</option>
              <option>Members only</option>
            </select>
          </label>

          <label>
            Promotional poster
            <input
              type="file"
              accept="image/*"
              onChange={(event) => {
                set_poster_name(event.target.files[0]?.name || '')
              }}
            />
          </label>

          {poster_name && (
            <p>Selected poster: {poster_name}</p>
          )}

          <button type="submit">
            Book venue and create event
          </button>
        </form>

        {success_message && (
          <p className="message">
            {success_message}
          </p>
        )}
      </section>
    </main>
  )
}

export default BookingPage
