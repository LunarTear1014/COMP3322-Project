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
    throw new Error('Could not check your account.')
  }

  const [clubs, memberships] = await Promise.all([
    clubs_response.json(),
    memberships_response.json(),
  ])
  const account =
    account_response.status === 401 ? null : await account_response.json()
  return { clubs, memberships, account }
}

function ClubsPage({ onMembershipsChange }) {
  const [clubs, set_clubs] = useState([])
  const [memberships, set_memberships] = useState([])
  const [logged_in, set_logged_in] = useState(false)
  const [load_state, set_load_state] = useState('loading')
  const [load_error, set_load_error] = useState('')
  const [updating_club_id, set_updating_club_id] = useState(null)
  const [updating_member, set_updating_member] = useState(null)
  const [committee_members, set_committee_members] = useState({})
  const [roster_loading, set_roster_loading] = useState({})
  const [roster_errors, set_roster_errors] = useState({})
  const [roster_search, set_roster_search] = useState({})
  const [join_requests, set_join_requests] = useState({})
  const [request_open, set_request_open] = useState({})
  const [request_loading, set_request_loading] = useState({})
  const [request_errors, set_request_errors] = useState({})
  const [new_club, set_new_club] = useState({ name: '', description: '' })
  const [transfer_forms, set_transfer_forms] = useState({})
  const [delete_confirmations, set_delete_confirmations] = useState({})
  const [message, set_message] = useState('')
  const [message_type, set_message_type] = useState('')

  function show_error(text) {
    set_message(text)
    set_message_type('error')
  }

  function show_success(text) {
    set_message(text)
    set_message_type('success')
  }

  function clear_message() {
    set_message('')
    set_message_type('')
  }

  useEffect(() => {
    let active = true

    async function load_clubs_and_memberships() {
      try {
        const {
          clubs: next_clubs,
          memberships: next_memberships,
          account,
        } =
          await fetch_clubs_and_memberships()
        if (!active) return
        set_clubs(next_clubs)
        set_memberships(next_memberships)
        set_logged_in(Boolean(account))
        onMembershipsChange(next_memberships)
        set_load_error('')
        set_load_state('ready')
      } catch (error) {
        if (active) {
          set_load_error(error.message || 'Could not load clubs. Please try again.')
          set_load_state('error')
        }
      }
    }

    load_clubs_and_memberships()
    const notification_interval = window.setInterval(async () => {
      try {
        const response = await fetch('/api/clubs')
        if (!response.ok) {
          throw new Error('Could not refresh club join-request notifications.')
        }
        set_clubs(await response.json())
      } catch {
        if (active) {
          set_message('Could not refresh club notifications. Check your connection.')
          set_message_type('error')
        }
      }
    }, 15000)
    return () => {
      active = false
      window.clearInterval(notification_interval)
    }
  }, [onMembershipsChange])

  useEffect(() => {
    const open_club_ids = Object.entries(request_open)
      .filter(([, is_open]) => is_open)
      .map(([club_id]) => club_id)
    if (!logged_in || open_club_ids.length === 0) return undefined

    let active = true
    const interval = window.setInterval(async () => {
      await Promise.all(
        open_club_ids.map(async (club_id) => {
          try {
            const response = await fetch(
              `/api/clubs/${club_id}/join-requests`,
            )
            const data = await response.json()
            if (!response.ok) {
              throw new Error(data.message || 'Could not refresh join requests.')
            }
            if (active) {
              set_join_requests((current) => ({ ...current, [club_id]: data }))
              set_request_errors((current) => ({ ...current, [club_id]: '' }))
            }
          } catch (error) {
            if (active) {
              set_request_errors((current) => ({
                ...current,
                [club_id]:
                  error.message || 'Could not refresh club join requests.',
              }))
            }
          }
        }),
      )
    }, 15000)

    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [logged_in, request_open])

  async function reload_clubs_and_memberships() {
    const {
      clubs: next_clubs,
      memberships: next_memberships,
      account,
    } =
      await fetch_clubs_and_memberships()
    set_clubs(next_clubs)
    set_memberships(next_memberships)
    set_logged_in(Boolean(account))
    onMembershipsChange(next_memberships)
  }

  async function retry_load_clubs() {
    set_load_state('loading')
    set_load_error('')
    try {
      await reload_clubs_and_memberships()
      set_load_state('ready')
    } catch (error) {
      set_load_error(error.message || 'Could not load clubs. Please try again.')
      set_load_state('error')
    }
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
        [club_id]:
          error.message ||
          'Could not load club members. Check your connection and try again.',
      }))
    } finally {
      set_roster_loading((current) => ({ ...current, [club_id]: false }))
    }
  }

  async function load_join_requests(club_id, force = false) {
    if (
      request_loading[club_id] ||
      (!force && Object.hasOwn(join_requests, club_id))
    ) {
      return
    }

    set_request_loading((current) => ({ ...current, [club_id]: true }))
    set_request_errors((current) => ({ ...current, [club_id]: '' }))
    try {
      const response = await fetch(`/api/clubs/${club_id}/join-requests`)
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.message || 'Could not load join requests.')
      }
      set_join_requests((current) => ({ ...current, [club_id]: data }))
    } catch (error) {
      set_request_errors((current) => ({
        ...current,
        [club_id]:
          error.message ||
          'Could not load join requests. Check your connection and try again.',
      }))
    } finally {
      set_request_loading((current) => ({ ...current, [club_id]: false }))
    }
  }

  async function toggle_membership(club) {
    if (club.is_member && club.role === 'president') return

    set_updating_club_id(club.id)
    clear_message()
    try {
      const response = await fetch(
        `/api/clubs/${club.id}/membership`,
        { method: club.is_member ? 'DELETE' : 'POST' },
      )
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Could not update membership.')
      }
      if (club.is_member) {
        await reload_clubs_and_memberships()
        set_committee_members((current) => {
          const next = { ...current }
          delete next[club.id]
          return next
        })
        show_success(`You left ${club.name}.`)
      } else {
        const data = await response.json()
        await reload_clubs_and_memberships()
        show_success(data.message || `Your request to join ${club.name} was sent.`)
      }
    } catch (error) {
      show_error(error.message || 'Could not reach the server. Please try again.')
    } finally {
      set_updating_club_id(null)
    }
  }

  async function review_join_request(club, request, decision) {
    const key = `${club.id}:${request.id}`
    set_updating_member(key)
    clear_message()
    try {
      const response = await fetch(
        `/api/clubs/${club.id}/join-requests/${request.id}/review`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision }),
        },
      )
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.message || 'Could not review join request.')
      }
      await reload_clubs_and_memberships()
      set_join_requests((current) => ({
        ...current,
        [club.id]: (current[club.id] || []).filter(
          (existing_request) => existing_request.id !== request.id,
        ),
      }))
      show_success(
        decision === 'accept'
          ? `${request.name} was accepted into ${club.name}.`
          : `${request.name}'s request to join ${club.name} was rejected.`,
      )
    } catch (error) {
      show_error(error.message || 'Could not reach the server. Please try again.')
    } finally {
      set_updating_member(null)
    }
  }

  async function promote_member(club, member) {
    const key = `${club.id}:${member.user_id}`
    set_updating_member(key)
    clear_message()
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
      show_success(`${member.name} is now on the ${club.name} committee.`)
    } catch (error) {
      show_error(error.message || 'Could not reach the server. Please try again.')
    } finally {
      set_updating_member(null)
    }
  }

  async function demote_member(club, member) {
    const key = `${club.id}:${member.user_id}`
    set_updating_member(key)
    clear_message()
    try {
      const response = await fetch(
        `/api/clubs/${club.id}/members/${member.user_id}/committee`,
        { method: 'DELETE' },
      )
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Could not change member role.')
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
      show_success(`${member.name} is now a regular member of ${club.name}.`)
    } catch (error) {
      show_error(error.message || 'Could not reach the server. Please try again.')
    } finally {
      set_updating_member(null)
    }
  }

  async function leave_committee(club) {
    set_updating_club_id(club.id)
    clear_message()
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
      show_success(`You left the ${club.name} committee and remain a member.`)
    } catch (error) {
      show_error(error.message || 'Could not reach the server. Please try again.')
    } finally {
      set_updating_club_id(null)
    }
  }

  async function create_new_club(event) {
    event.preventDefault()
    clear_message()
    try {
      const response = await fetch('/api/clubs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(new_club),
      })
      const data = response.status === 204 ? null : await response.json()
      if (!response.ok) {
        throw new Error(data.message || 'Could not create club.')
      }
      set_new_club({ name: '', description: '' })
      await reload_clubs_and_memberships()
      show_success(`${data.name} was created. You are its president.`)
    } catch (error) {
      show_error(error.message || 'Could not reach the server. Please try again.')
    }
  }

  async function transfer_presidency(club) {
    const form = transfer_forms[club.id] || {}
    set_updating_club_id(club.id)
    clear_message()
    try {
      const response = await fetch(`/api/clubs/${club.id}/presidency`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: Number(form.user_id),
          confirmation: form.confirmation || '',
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.message || 'Could not transfer presidency.')
      }
      await reload_clubs_and_memberships()
      set_committee_members((current) => {
        const next = { ...current }
        delete next[club.id]
        return next
      })
      show_success(`Presidency of ${club.name} was transferred.`)
    } catch (error) {
      show_error(error.message || 'Could not reach the server. Please try again.')
    } finally {
      set_updating_club_id(null)
    }
  }

  async function delete_club(club) {
    set_updating_club_id(club.id)
    clear_message()
    try {
      const response = await fetch(`/api/clubs/${club.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmation: delete_confirmations[club.id] || '',
        }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Could not delete club.')
      }
      set_committee_members((current) => {
        const next = { ...current }
        delete next[club.id]
        return next
      })
      await reload_clubs_and_memberships()
      show_success(`${club.name} and its events and bookings were deleted.`)
    } catch (error) {
      show_error(error.message || 'Could not reach the server. Please try again.')
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

      {message && (
        <p
          className={`message ${message_type === 'error' ? 'error-message' : ''}`}
          role={message_type === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          {message}
        </p>
      )}

      <section>
        <p>Campus clubs</p>
        <h2>Find a club to join</h2>
        <details className="club-roster">
            <summary>Create a new club</summary>
            {!logged_in && (
              <p className="field-hint">
                You need to sign in before creating a club.{' '}
                <NavLink to="/account">Sign in or create an account</NavLink>.
              </p>
            )}
            <form onSubmit={create_new_club}>
              <label>
                Club name
                <input
                  maxLength={255}
                  required
                  value={new_club.name}
                  onChange={(event) =>
                    set_new_club((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Description
                <textarea
                  maxLength={5000}
                  value={new_club.description}
                  onChange={(event) =>
                    set_new_club((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                />
              </label>
              <button type="submit" disabled={updating_club_id !== null}>
                Create club
              </button>
            </form>
        </details>
        {load_state === 'loading' && <p>Loading clubs…</p>}
        {load_state === 'error' && (
          <div className="message error-message" role="alert">
            <p>{load_error}</p>
            <button type="button" onClick={retry_load_clubs}>
              Try again
            </button>
          </div>
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
            {!(club.is_member && club.role === 'president') && (
              <button
                type="button"
                disabled={
                  updating_club_id !== null ||
                  updating_member !== null ||
                  (!club.is_member && club.request_status === 'pending')
                }
                onClick={() => toggle_membership(club)}
              >
                {updating_club_id === club.id
                  ? 'Updating…'
                  : club.is_member
                    ? 'Leave club'
                    : club.request_status === 'pending'
                      ? 'Request pending'
                      : club.request_status === 'rejected'
                        ? 'Request to join again'
                        : 'Request to join'}
              </button>
            )}
            {!club.is_member && club.request_status === 'pending' && (
              <p className="membership-role" role="status">
                Your request is waiting for committee or president approval.
              </p>
            )}
            {!club.is_member && club.request_status === 'rejected' && (
              <p className="membership-role" role="status">
                Your previous request was rejected. You may request again.
              </p>
            )}
            {['committee', 'president'].includes(club.role) && (
              <>
                {club.role === 'committee' && (
                  <button
                    type="button"
                    disabled={updating_club_id !== null || updating_member !== null}
                    onClick={() => leave_committee(club)}
                  >
                    {updating_club_id === club.id
                      ? 'Updating…'
                      : 'Leave committee'}
                  </button>
                )}
                <details
                  className="club-roster"
                  onToggle={(event) => {
                    const is_open = event.currentTarget.open
                    set_request_open((current) => ({
                      ...current,
                      [club.id]: is_open,
                    }))
                    if (is_open) {
                      load_join_requests(club.id, true)
                    }
                  }}
                >
                  <summary>
                    Join requests ({Number(club.pending_request_count) || 0})
                  </summary>
                  {request_loading[club.id] && <p>Loading join requests…</p>}
                  {request_errors[club.id] && (
                    <div className="message error-message" role="alert">
                      <p>{request_errors[club.id]}</p>
                      <button
                        type="button"
                        onClick={() => load_join_requests(club.id, true)}
                      >
                        Try again
                      </button>
                    </div>
                  )}
                  {join_requests[club.id]?.length === 0 && (
                    <p>There are no pending join requests.</p>
                  )}
                  {(join_requests[club.id] || []).map((request) => (
                    <div className="row" key={request.id}>
                      <span>
                        {request.name}
                        <span className="membership-role">
                          {' · Requested '}
                          {new Date(request.requested_at).toLocaleDateString()}
                        </span>
                      </span>
                      <div className="request-actions">
                        <button
                          type="button"
                          disabled={updating_member !== null}
                          onClick={() =>
                            review_join_request(club, request, 'accept')
                          }
                        >
                          {updating_member === `${club.id}:${request.id}`
                            ? 'Updating…'
                            : 'Accept'}
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={updating_member !== null}
                          onClick={() =>
                            review_join_request(club, request, 'reject')
                          }
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </details>
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
                            {club.role === 'president' &&
                              member.role === 'committee' && (
                                  <button
                                    type="button"
                                    disabled={
                                      updating_member !== null ||
                                      updating_club_id !== null
                                    }
                                    onClick={() => demote_member(club, member)}
                                  >
                                    {updating_member ===
                                    `${club.id}:${member.user_id}`
                                      ? 'Updating…'
                                      : 'Make regular member'}
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
                {club.role === 'president' && (
                  <>
                    <details
                      className="club-roster"
                      onToggle={(event) => {
                        if (event.currentTarget.open) {
                          load_club_members(club.id)
                        }
                      }}
                    >
                      <summary>Transfer presidency</summary>
                      <p>
                        The selected committee member will become president,
                        and you will become a committee member.
                      </p>
                      <form
                        onSubmit={(event) => {
                          event.preventDefault()
                          transfer_presidency(club)
                        }}
                      >
                        <label>
                          New president
                          <select
                            required
                            value={transfer_forms[club.id]?.user_id || ''}
                            onChange={(event) =>
                              set_transfer_forms((current) => ({
                                ...current,
                                [club.id]: {
                                  ...current[club.id],
                                  user_id: event.target.value,
                                },
                              }))
                            }
                          >
                            <option value="">Select a committee member</option>
                            {(committee_members[club.id] || [])
                              .filter((member) => member.role === 'committee')
                              .map((member) => (
                                <option
                                  key={member.user_id}
                                  value={member.user_id}
                                >
                                  {member.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label>
                          Type “{club.name}” to confirm the transfer
                          <input
                            required
                            value={
                              transfer_forms[club.id]?.confirmation || ''
                            }
                            onChange={(event) =>
                              set_transfer_forms((current) => ({
                                ...current,
                                [club.id]: {
                                  ...current[club.id],
                                  confirmation: event.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                        <button
                          type="submit"
                          disabled={
                            updating_club_id !== null ||
                            !(committee_members[club.id] || []).some(
                              (member) => member.role === 'committee',
                            )
                          }
                        >
                          Transfer presidency
                        </button>
                      </form>
                    </details>
                    <details className="club-roster">
                      <summary>Delete club</summary>
                      <p>
                        This permanently deletes the club, its memberships,
                        events, and bookings.
                      </p>
                      <form
                        onSubmit={(event) => {
                          event.preventDefault()
                          delete_club(club)
                        }}
                      >
                        <label>
                          Type “{club.name}” to confirm deletion
                          <input
                            required
                            value={delete_confirmations[club.id] || ''}
                            onChange={(event) =>
                              set_delete_confirmations((current) => ({
                                ...current,
                                [club.id]: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <button
                          type="submit"
                          disabled={updating_club_id !== null}
                        >
                          Delete club permanently
                        </button>
                      </form>
                    </details>
                  </>
                )}
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

    </main>
  )
}

export default ClubsPage
