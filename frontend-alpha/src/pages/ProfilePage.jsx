import { useState, useEffect } from 'react'
import { NavLink } from 'react-router'
import '../App.css'

const all_clubs = [
  'Photography Society',
  'Film Society',
  'Debate Club',
]

function ProfilePage({ student_clubs, onToggleClub }) {
  const [profile, set_profile] = useState({
    name: 'Charlie Chan',
    email: 'charlie@example.com',
  })

  const [saved_message, set_saved_message] = useState('')

  useEffect(() => {
    async function load_profile() {
      try {
        const response = await fetch('/api/profile')
        if (response.ok) set_profile(await response.json())
      } catch {
        // keep the default values if the server isn't reachable
      }
    }
    load_profile()
  }, [])

  function handle_change(event) {
    set_profile({
      ...profile,
      [event.target.name]: event.target.value,
    })
  }

  async function handle_submit(event) {
    event.preventDefault()
    try {
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      })
      const data = await response.json()
      set_saved_message(response.ok ? 'Profile saved successfully.' : data.message)
    } catch {
      set_saved_message('Could not reach the server.')
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
        <p>Student profile</p>
        <h2>Your personal details</h2>

        <form onSubmit={handle_submit}>
          <label>
            Full name
            <input
              name="name"
              value={profile.name}
              onChange={handle_change}
            />
          </label>

          <label>
            Email
            <input
              name="email"
              type="email"
              value={profile.email}
              onChange={handle_change}
            />
          </label>

          <button type="submit">Save profile</button>
        </form>

        {saved_message && (
          <p className="message">
            {saved_message}
          </p>
        )}

        <section>
        <p>Club memberships</p>
        <h2>Join campus clubs</h2>

        {all_clubs.map((club) => (
            <div className="row" key={club}>
            <span>{club}</span>

            <button
                type="button"
                onClick={() => onToggleClub(club)}
            >
                {student_clubs.includes(club)
                ? 'Leave club'
                : 'Join club'}
            </button>
            </div>
        ))}
        </section>
      </section>
    </main>
  )
}

export default ProfilePage
