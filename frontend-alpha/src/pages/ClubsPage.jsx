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
  const [updating_member, set_updating_member] = useState(null)
  const [committee_members, set_committee_members] = useState({})
  const [roster_loading, set_roster_loading] = useState({})
  const [roster_errors, set_roster_errors] = useState({})
  const [roster_search, set_roster_search] = useState({})
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

  async function load_club_members(club_id) {
    if (
      Object.hasOwn(committee_members, club_id) ||
      roster_loading[club_id]
    ) {
      return
    }

    set_roster_loading((current) => ({ ...current, [club_id]: true }))
    set_roster_errors((current) => ({ ...current, [club_id]: '' }))
    try {
      const response = await fetch(`/api/clubs/${club_id}/members`)
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.message || 'Could not load club members.')
      }
      set_committee_members((current) => ({ ...current, [club_id]: data }))
    } catch (error) {
      set_roster_errors((current) => ({
        ...current,
        [club_id]: error.message || 'Could not reach the server.',
      }))
    } finally {
      set_roster_loading((current) => ({ ...current, [club_id]: false }))
    }
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
      set_committee_members((current) => {
        const next = { ...current }
        delete next[club.id]
        return next
      })
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
      const roster_response = await fetch(`/api/clubs/${club.id}/members`)
      const roster = await roster_response.json()
      if (!roster_response.ok) {
        throw new Error(roster.message || 'Could not refresh club members.')
      }
      set_committee_members((current) => ({
        ...current,
        [club.id]: roster,
      }))
      set_message(`${member.name} is now on the ${club.name} committee.`)
    } catch (error) {
      set_message(error.message || 'Could not reach the server.')
    } finally {
      set_updating_member(null)
    }
  }

  async function leave_committee(club) {
    set_updating_club_id(club.id)
    set_message('')
    try {
      const response = await fetch(`/api/clubs/${club.id}/committee`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Could not leave the committee.')
      }
      await reload_clubs_and_memberships()
      set_committee_members((current) => {
        const next = { ...current }
        delete next[club.id]
        return next
      })
      set_message(`You left the ${club.name} committee and remain a member.`)
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
        {clubs.map((club) => {
          const search = (roster_search[club.id] || '')
            .trim()
            .toLocaleLowerCase()
          const filtered_members = (committee_members[club.id] || []).filter(
            (member) => member.name.toLocaleLowerCase().includes(search),
          )

          return (
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
            {club.role === 'committee' && (
              <>
                <button
                  type="button"
                  disabled={updating_club_id !== null || updating_member !== null}
                  onClick={() => leave_committee(club)}
                >
                  {updating_club_id === club.id
                    ? 'Updating…'
                    : 'Leave committee'}
                </button>
                <details
                  className="club-roster"
                  onToggle={(event) => {
                    if (event.currentTarget.open) {
                      load_club_members(club.id)
                    }
                  }}
                >
                  <summary>View club members</summary>
                  {roster_loading[club.id] && <p>Loading members…</p>}
                  {roster_errors[club.id] && (
                    <p className="message">
                      {roster_errors[club.id]}
                      <button
                        type="button"
                        onClick={() => load_club_members(club.id)}
                      >
                        Try again
                      </button>
                    </p>
                  )}
                  {committee_members[club.id] && (
                    <>
                      <label>
                        Search members by name
                        <input
                          type="search"
                          value={roster_search[club.id] || ''}
                          onChange={(event) =>
                            set_roster_search((current) => ({
                              ...current,
                              [club.id]: event.target.value,
                            }))
                          }
                        />
                      </label>
                      {filtered_members.length > 0 ? (
                        filtered_members.map((member) => (
                          <div className="row" key={member.user_id}>
                            <span>
                              {member.name}
                              <span className="membership-role">
                                {' · '}{member.role}
                              </span>
                            </span>
                            {member.role === 'member' && (
                              <button
                                type="button"
                                disabled={
                                  updating_member !== null ||
                                  updating_club_id !== null
                                }
                                onClick={() => promote_member(club, member)}
                              >
                                {updating_member ===
                                `${club.id}:${member.user_id}`
                                  ? 'Promoting…'
                                  : 'Make committee'}
                              </button>
                            )}
                          </div>
                        ))
                      ) : (
                        <p>No matching members.</p>
                      )}
                    </>
                  )}
                </details>
              </>
            )}
          </article>
          )
        })}
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
