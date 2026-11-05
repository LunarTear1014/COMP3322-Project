import { useEffect, useState } from 'react'
import { NavLink } from 'react-router'
import '../App.css'

async function fetch_clubs_and_memberships() {
  const [clubs_response, memberships_response] = await Promise.all([
    fetch('/api/clubs'),
    fetch('/api/memberships'),
  ])
  if (!clubs_response.ok || !memberships_response.ok) {
    throw new Error('Could not load clubs.')
  }

  const [clubs, memberships] = await Promise.all([
    clubs_response.json(),
    memberships_response.json(),
  ])
  return { clubs, memberships }
}

function ClubsPage({ onMembershipsChange }) {
  const [clubs, set_clubs] = useState([])
  const [memberships, set_memberships] = useState([])
  const [load_state, set_load_state] = useState('loading')
  const [updating_club_id, set_updating_club_id] = useState(null)
  const [message, set_message] = useState('')

  useEffect(() => {
    let active = true

    async function load_clubs_and_memberships() {
      try {
        const { clubs: next_clubs, memberships: next_memberships } =
          await fetch_clubs_and_memberships()
        if (!active) return
        set_clubs(next_clubs)
        set_memberships(next_memberships)
        onMembershipsChange(next_memberships)
        set_load_state('ready')
      } catch {
        if (active) set_load_state('error')
      }
    }

    load_clubs_and_memberships()
    return () => {
      active = false
    }
  }, [onMembershipsChange])

  async function reload_clubs_and_memberships() {
    const { clubs: next_clubs, memberships: next_memberships } =
      await fetch_clubs_and_memberships()
    set_clubs(next_clubs)
    set_memberships(next_memberships)
    onMembershipsChange(next_memberships)
  }

  async function toggle_membership(club) {
    set_updating_club_id(club.id)
    set_message('')
    try {
      const response = await fetch(
        `/api/clubs/${club.id}/membership`,
        { method: club.is_member ? 'DELETE' : 'POST' },
      )
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Could not update membership.')
      }
      await reload_clubs_and_memberships()
      set_message(
        club.is_member
          ? `You left ${club.name}.`
          : `You joined ${club.name}.`,
      )
    } catch (error) {
      set_message(error.message || 'Could not reach the server.')
    } finally {
      set_updating_club_id(null)
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
          <NavLink to="/clubs">Clubs</NavLink>
        </nav>
      </header>

      <section>
        <p>Campus clubs</p>
        <h2>Find a club to join</h2>
        {load_state === 'loading' && <p>Loading clubs…</p>}
        {load_state === 'error' && (
          <p className="message">Could not load clubs. Please try again.</p>
        )}
        {load_state === 'ready' && clubs.length === 0 && (
          <p>No clubs are available.</p>
        )}
        {clubs.map((club) => (
          <article key={club.id}>
            <h4>{club.name}</h4>
            <p>{club.description || 'No description available.'}</p>
            <button
              type="button"
              disabled={updating_club_id !== null}
              onClick={() => toggle_membership(club)}
            >
              {updating_club_id === club.id
                ? 'Updating…'
                : club.is_member
                  ? 'Leave club'
                  : 'Join club'}
            </button>
          </article>
        ))}
      </section>

      <section>
        <p>Your memberships</p>
        <h2>Clubs you have joined</h2>
        {memberships.length === 0 && load_state === 'ready' && (
          <p>You have not joined any clubs yet.</p>
        )}
        {memberships.map((membership) => (
          <div className="row" key={membership.club_id}>
            <span>
              {membership.name}
              <span className="membership-role"> · {membership.role}</span>
            </span>
          </div>
        ))}
      </section>

      {message && <p className="message">{message}</p>}
    </main>
  )
}

export default ClubsPage
