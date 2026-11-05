import { useEffect, useState } from 'react'
import { NavLink } from 'react-router'
import '../App.css'

async function fetch_clubs_and_memberships() {
  const [clubs_response, memberships_response, account_response] = await Promise.all([
    fetch('/api/clubs'),
    fetch('/api/memberships'),
    fetch('/api/auth/me'),
  ])
  if (!clubs_response.ok || !memberships_response.ok) {
    throw new Error('Could not load clubs.')
  }
  if (!account_response.ok && account_response.status !== 401) {
    throw new Error('Could not check your account permissions.')
  }

  const [clubs, memberships] = await Promise.all([
    clubs_response.json(),
    memberships_response.json(),
  ])
  const account =
    account_response.status === 401 ? null : await account_response.json()
  const committee_clubs = account
    ? clubs.filter((club) => club.role === 'committee')
    : []
  const rosters = await Promise.all(
    committee_clubs.map(async (club) => {
      const response = await fetch(`/api/clubs/${club.id}/members`)
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Could not load committee members.')
      }
      return [club.id, await response.json()]
    }),
  )
  return { clubs, memberships, committee_members: Object.fromEntries(rosters) }
}

function ClubsPage({ onMembershipsChange }) {
  const [clubs, set_clubs] = useState([])
  const [memberships, set_memberships] = useState([])
  const [load_state, set_load_state] = useState('loading')
  const [updating_club_id, set_updating_club_id] = useState(null)
  const [updating_member, set_updating_member] = useState(null)
  const [committee_members, set_committee_members] = useState({})
  const [message, set_message] = useState('')

  useEffect(() => {
    let active = true

    async function load_clubs_and_memberships() {
      try {
        const {
          clubs: next_clubs,
          memberships: next_memberships,
          committee_members: next_committee_members,
        } =
          await fetch_clubs_and_memberships()
        if (!active) return
        set_clubs(next_clubs)
        set_memberships(next_memberships)
        set_committee_members(next_committee_members)
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
    const {
      clubs: next_clubs,
      memberships: next_memberships,
      committee_members: next_committee_members,
    } =
      await fetch_clubs_and_memberships()
    set_clubs(next_clubs)
    set_memberships(next_memberships)
    set_committee_members(next_committee_members)
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

  async function promote_member(club, member) {
    const key = `${club.id}:${member.user_id}`
    set_updating_member(key)
    set_message('')
    try {
      const response = await fetch(
        `/api/clubs/${club.id}/members/${member.user_id}/committee`,
        { method: 'POST' },
      )
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Could not promote member.')
      }
      await reload_clubs_and_memberships()
      set_message(`${member.name} is now on the ${club.name} committee.`)
    } catch (error) {
      set_message(error.message || 'Could not reach the server.')
    } finally {
      set_updating_member(null)
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
            {club.is_member && (
              <p className="membership-role">
                Your role: {club.role}
              </p>
            )}
            <button
              type="button"
              disabled={updating_club_id !== null || updating_member !== null}
              onClick={() => toggle_membership(club)}
            >
              {updating_club_id === club.id
                ? 'Updating…'
                : club.is_member
                  ? 'Leave club'
                  : 'Join club'}
            </button>
            {club.role === 'committee' &&
              (committee_members[club.id] || []).length > 0 && (
                <div>
                  <h5>Manage committee</h5>
                  {committee_members[club.id].map((member) => (
                    <div className="row" key={member.user_id}>
                      <span>
                        {member.name}
                        <span className="membership-role"> · {member.role}</span>
                      </span>
                      {member.role === 'member' && (
                        <button
                          type="button"
                          disabled={updating_member !== null || updating_club_id !== null}
                          onClick={() => promote_member(club, member)}
                        >
                          {updating_member === `${club.id}:${member.user_id}`
                            ? 'Promoting…'
                            : 'Make committee'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
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
