import { useState, useEffect } from 'react'
import { NavLink } from 'react-router'
import '../App.css'

function EventsPage({
  student_clubs,
  membership_error,
  can_manage_venues,
}) {
  const [search_term, set_search_term] = useState('')
  const [selected_event, set_selected_event] = useState(null)
  const [participation_message, set_participation_message] = useState('')
  const [participation_message_type, set_participation_message_type] = useState('')
  const [updating_event_id, set_updating_event_id] = useState(null)
  const [event_status_filter, set_event_status_filter] = useState('Upcoming')
  const [events, set_events] = useState([])
  const [load_state, set_load_state] = useState('loading') // loading | ready | error
  const [account_state, set_account_state] = useState('loading')

  useEffect(() => {
    let active = true

    async function load_events() {
      try {
        const response = await fetch('/api/events')
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const next_events = await response.json()
        if (active) {
          set_events(next_events)
          set_selected_event((current) =>
            current
              ? next_events.find((event) => event.id === current.id) || current
              : null,
          )
          set_load_state('ready')
        }
      } catch (error) {
        if (active) {
          set_load_state('error')
          set_participation_message(
            error.message || 'Could not refresh event signup status.',
          )
          set_participation_message_type('warning')
        }
      }
    }
    async function load_account_state() {
      try {
        const response = await fetch('/api/auth/me')
        if (active) {
          set_account_state(
            response.ok ? 'signed_in' : response.status === 401 ? 'signed_out' : 'error',
          )
        }
      } catch {
        if (active) set_account_state('error')
      }
    }
    load_events()
    load_account_state()
    const interval = window.setInterval(load_events, 15000)
    const account_interval = window.setInterval(load_account_state, 15000)
    return () => {
      active = false
      window.clearInterval(interval)
      window.clearInterval(account_interval)
    }
  }, [])
  
  const visible_events = events.filter((event) => {
    const searchable_text = `${event.title} ${event.club} ${event.venue} ${event.description}`.toLowerCase()
    return (
      searchable_text.includes(search_term.toLowerCase()) &&
      event.status === event_status_filter
    )
  })

  function can_join_event(event) {
    if (event.visibility === 'Public') {
      return true
    } else if (event.visibility === 'Members only') {
      return !membership_error && student_clubs.includes(event.club)
    }
    return false
  }

  async function toggle_join_event(event) {
    if (account_state !== 'signed_in') {
      set_participation_message('Sign in to join or leave an event.')
      set_participation_message_type('error')
      return
    }

    const prior_status =
      event.participation_status || (event.is_joined ? 'joined' : null)
    const joining = !['joined', 'waitlisted'].includes(prior_status)
    if (joining && !can_join_event(event)) {
      set_participation_message(
        'Join the organizing club before joining this members-only event.'
      )
      set_participation_message_type('error')
      return
    }

    set_updating_event_id(event.id)
    set_participation_message('')
    set_participation_message_type('')
    try {
      const response = await fetch(
        `/api/events/${event.id}/participation`,
        { method: joining ? 'POST' : 'DELETE' }
      )
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Could not update event participation.')
      }

      const signup = joining ? await response.json() : null
      const next_status = joining ? signup.status : null
      const update_participation = (current_event) =>
        current_event?.id === event.id
          ? {
              ...current_event,
              is_joined: next_status === 'joined',
              participation_status: next_status,
              joined_count:
                current_event.joined_count +
                (joining
                  ? next_status === 'joined'
                    ? 1
                    : 0
                  : prior_status === 'joined'
                    ? -1
                    : 0),
            }
          : current_event
      set_events((current_events) =>
        current_events.map(update_participation)
      )
      set_selected_event(update_participation)
      if (joining) {
        set_participation_message(
          next_status === 'waitlisted'
            ? 'The event is full. You have been added to the waitlist.'
            : 'You joined the event.',
        )
        set_participation_message_type('success')
      } else {
        set_participation_message(
          prior_status === 'waitlisted'
            ? 'You left the event waitlist.'
            : 'You left the event.',
        )
        set_participation_message_type('success')
      }

      const events_response = await fetch('/api/events')
      if (!events_response.ok) {
        set_participation_message(
          'Your signup was saved, but event details could not be refreshed.'
        )
        set_participation_message_type('warning')
        return
      }
      const updated_events = await events_response.json()
      set_events(updated_events)
      set_selected_event(
        updated_events.find((updated_event) => updated_event.id === event.id)
      )
    } catch (error) {
      set_participation_message(
        error.message || 'Could not reach the server.'
      )
      set_participation_message_type('error')
    } finally {
      set_updating_event_id(null)
    }
  }

  return (
    <main>
      <header> 
        <h1> ClubSpace </h1>
        <nav>
        <NavLink to="/events">Events</NavLink>
        {can_manage_venues && <NavLink to="/venues">Venues</NavLink>}
        <NavLink to="/clubs">Clubs</NavLink>
        <NavLink to="/account">Account</NavLink>
        </nav>
      </header>
      <section>
        <p> Event Search </p>
        {membership_error && (
          <p className="message error-message" role="alert">
            Could not load your memberships. Membership-only event access
            cannot be checked.
          </p>
        )}
        <input
          placeholder ="Search events for each club" 
          value={search_term}
          onChange={(e) => set_search_term(e.target.value)}
        /> 
      </section>  
      <section>
        <p> {event_status_filter} Events </p>
        <div className="list">
          <button
            className={event_status_filter === 'Upcoming' ? 'option selected' : 'option'}
            onClick={() => set_event_status_filter('Upcoming')}
          >
            Upcoming
          </button>

          <button
            className={event_status_filter === 'Past' ? 'option selected' : 'option'}
            onClick={() => set_event_status_filter('Past')}
          >
            Past
          </button>
        </div>
      </section>  
      <section>
        {visible_events.map((event) => (
          <article key={event.id}>
            <p>{event.club}</p>
            <p className="badge">{event.visibility}</p>
            {event.is_full && <p className="badge full-badge">Event full</p>}
            {event.participation_status === 'waitlisted' && (
              <p className="badge">Waitlisted</p>
            )}
            <h4>{event.title}</h4>
            <p>{event.date}, {event.timeslot}</p>
            <p>{event.venue}</p>
              {event.is_joined && <p className="badge">Joined</p>}
            <button onClick={() => set_selected_event(event)}>View event</button>
          </article>
        ))}
        {load_state === 'loading' && <p>Loading events…</p>}
        {load_state === 'error' && (
          <p className="message error-message" role="alert">
            Could not load events. Check your connection and try again.
          </p>
        )}
        {load_state === 'ready' && visible_events.length === 0 && <p>No events found</p>}
      </section>  
      {selected_event && (
        <section className="panel">
          <p> Event Details </p>
          <h4>{selected_event.title}</h4>
          <p>Date: {selected_event.date}, {selected_event.timeslot}</p>
          <p>Club: {selected_event.club}</p>
          <p>Venue: {selected_event.venue}</p>
          <p>Description: {selected_event.description}</p>
          <p>Visibility: {selected_event.visibility}</p>
          <p>Status: {selected_event.status}</p>
          <p>Joined Count: {selected_event.joined_count}</p>
          <p>Capacity: {selected_event.capacity}</p>
          {selected_event.is_full && (
            <p className="badge full-badge" role="status">Event full</p>
          )}
          {selected_event.participation_status === 'waitlisted' && (
            <p className="message" role="status">
              You are on the waitlist. We will promote you automatically when a
              spot opens.
            </p>
          )}
          {account_state === 'signed_in' ? (
            <button
              onClick={() => toggle_join_event(selected_event)}
              disabled={
                updating_event_id === selected_event.id ||
                (!selected_event.is_joined &&
                  selected_event.participation_status !== 'waitlisted' &&
                  !can_join_event(selected_event))
              }
            >
              {updating_event_id === selected_event.id
                ? 'Updating…'
                : selected_event.is_joined
                  ? 'Leave Event'
                  : selected_event.participation_status === 'waitlisted'
                    ? 'Leave waitlist'
                    : !can_join_event(selected_event)
                      ? 'Members only'
                      : selected_event.is_full
                        ? 'Join waitlist'
                        : 'Join Event'}
            </button>
          ) : account_state === 'signed_out' ? (
            <p className="message">
              <NavLink to="/account">Sign in</NavLink> to join this event.
            </p>
          ) : account_state === 'loading' ? (
            <p className="message" role="status">Checking your sign-in status…</p>
          ) : (
            <p className="message error-message" role="alert">
              Could not verify your sign-in status. Refresh the page before
              joining an event.
            </p>
          )}
        {!selected_event.is_joined &&
          selected_event.participation_status !== 'waitlisted' &&
          !can_join_event(selected_event) && (
          <p className="message error-message" role="alert">
            {membership_error
              ? 'Could not verify your club memberships.'
              : 'You cannot join this event because it is for members only.'}
          </p>
        )}
        {participation_message && (
          <p
            className={`message ${participation_message_type === 'error' ? 'error-message' : ''}`}
            role={participation_message_type === 'error' ? 'alert' : 'status'}
            aria-live="polite"
          >
            {participation_message}
          </p>
        )}
        <button onClick={() => set_selected_event(null)}>Close details</button>  
        </section>  
      )}

    </main>
  )
}

export default EventsPage
