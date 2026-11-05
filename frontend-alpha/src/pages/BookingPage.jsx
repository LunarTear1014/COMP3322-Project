import { useEffect, useState } from 'react'
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
    club: '',
    title: '',
    description: '',
    date: location.state?.date || '',
    venue: location.state?.venue || '',
    timeslot: location.state?.timeslot || '',
    visibility: 'Public',
  })

  const [poster_name, set_poster_name] = useState('')
  const [message, set_message] = useState('')
  const [message_type, set_message_type] = useState('')
  const [submitting, set_submitting] = useState(false)
  const [authorized_clubs, set_authorized_clubs] = useState([])
  const [membership_state, set_membership_state] = useState('loading')

  useEffect(() => {
    let active = true

    async function load_authorized_clubs() {
      try {
        const response = await fetch('/api/memberships')
        if (!response.ok) {
          throw new Error('Could not verify your club roles.')
        }
        const memberships = await response.json()
        const eligible_clubs = memberships.filter((membership) =>
          ['committee', 'president'].includes(membership.role),
        )
        if (!active) return
        set_authorized_clubs(eligible_clubs)
        set_form((current) => ({
          ...current,
          club: eligible_clubs.some((club) => club.name === current.club)
            ? current.club
            : eligible_clubs[0]?.name || '',
        }))
        set_membership_state('ready')
      } catch {
        if (active) set_membership_state('error')
      }
    }

    load_authorized_clubs()
    return () => {
      active = false
    }
  }, [])

  function handle_change(event) {
    set_form({
      ...form,
      [event.target.name]: event.target.value,
    })
  }

  async function handle_submit(event) {
    event.preventDefault()
    set_message('')
    set_message_type('')

    if (!form.venue || !form.timeslot) {
      set_message('Please select a venue and timeslot.')
      set_message_type('error')
      return
    }

    set_submitting(true)
    try {
      const response = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),   // form already has exactly the fields the server wants
      })
      const data = await response.json()

      if (!response.ok) {
        set_message(data.message || 'Could not create the event. Please check the details and try again.')
        set_message_type('error')
        return
      }
      set_message(
        `${data.title} has been created and the venue booking is confirmed.`
      )
      set_message_type('success')
    } catch {
      set_message('Could not reach the server. Please try again.')
      set_message_type('error')
    } finally {
      set_submitting(false)
    }
  }

  return (
    <main>
      <header>
        <h1>ClubSpace</h1>

        <nav>
          <NavLink to="/events">Events</NavLink>
          <NavLink to="/venues">Venues</NavLink>
          <NavLink to="/clubs">Clubs</NavLink>
          <NavLink to="/account">Account</NavLink>
        </nav>
      </header>

      <section className="panel">
        <p>Organizer tools</p>
        <h2>Book venue and create event</h2>

        {membership_state === 'loading' && <p>Checking your club roles…</p>}
        {membership_state === 'error' && (
          <p className="message error-message" role="alert">
            Could not verify your club roles. Refresh the page and try again.
          </p>
        )}
        {membership_state === 'ready' && authorized_clubs.length === 0 && (
          <p className="message" role="status">
            You must be signed in as a committee member or president of a club
            to book a venue. Regular members can still join events.
          </p>
        )}

        {membership_state === 'ready' && authorized_clubs.length > 0 && (
          <form onSubmit={handle_submit}>
            <label>
              Club
              <select name="club" value={form.club} onChange={handle_change}>
                {authorized_clubs.map((club) => (
                  <option key={club.club_id} value={club.name}>
                    {club.name} ({club.role})
                  </option>
                ))}
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

            {poster_name && <p>Selected poster: {poster_name}</p>}

            <button type="submit" disabled={submitting}>
              {submitting ? 'Creating event…' : 'Book venue and create event'}
            </button>
          </form>
        )}

        {message && (
          <p
            className={`message ${message_type === 'error' ? 'error-message' : ''}`}
            role={message_type === 'error' ? 'alert' : 'status'}
            aria-live="polite"
          >
            {message}
          </p>
        )}
      </section>
    </main>
  )
}

export default BookingPage
