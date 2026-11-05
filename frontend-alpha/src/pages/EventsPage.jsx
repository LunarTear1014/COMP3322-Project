import { useState, useEffect } from 'react'
import { NavLink } from 'react-router'
import '../App.css'

function EventsPage({ student_clubs, membership_error }) {
  const [search_term, set_search_term] = useState('')
  const [selected_event, set_selected_event] = useState(null)
  const [participation_message, set_participation_message] = useState('')
  const [updating_event_id, set_updating_event_id] = useState(null)
  const [event_status_filter, set_event_status_filter] = useState('Upcoming')
  const [events, set_events] = useState([])
  const [load_state, set_load_state] = useState('loading') // loading | ready | error

  useEffect(() => {
    async function load_events() {
      try {
        const response = await fetch('/api/events')
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        set_events(await response.json())
        set_load_state('ready')
      } catch {
        set_load_state('error')
      }
    }
    load_events()
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
    const joining = !event.is_joined
    if (joining && !can_join_event(event)) {
      set_participation_message(
        'Join the organizing club before joining this members-only event.'
      )
      return
    }

    set_updating_event_id(event.id)
    set_participation_message('')
    try {
      const response = await fetch(
        `/api/events/${event.id}/participation`,
        { method: joining ? 'POST' : 'DELETE' }
      )
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Could not update event participation.')
      }

      const update_participation = (current_event) =>
        current_event?.id === event.id
          ? {
              ...current_event,
              is_joined: joining,
              joined_count: current_event.joined_count + (joining ? 1 : -1),
            }
          : current_event
      set_events((current_events) =>
        current_events.map(update_participation)
      )
      set_selected_event(update_participation)

      const events_response = await fetch('/api/events')
      if (!events_response.ok) {
        set_participation_message(
          'Your signup was saved, but event details could not be refreshed.'
        )
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
        <NavLink to="/venues">Venues</NavLink>
        <NavLink to="/clubs">Clubs</NavLink>
        <NavLink to="/account">Account</NavLink>
        </nav>
      </header>
      <section>
        <p> Event Search </p>
        {membership_error && (
          <p className="message">
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
            <h4>{event.title}</h4>
            <p>{event.date}, {event.timeslot}</p>
            <p>{event.venue}</p>
              {event.is_joined && <p className="badge">Joined</p>}
            <button onClick={() => set_selected_event(event)}>View event</button>
          </article>
        ))}
        {load_state === 'loading' && <p>Loading events…</p>}
        {load_state === 'error' && <p className="message">Could not reach the server.</p>}
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
          <button
            onClick={() => toggle_join_event(selected_event)}
            disabled={
              updating_event_id === selected_event.id ||
              (!selected_event.is_joined && !can_join_event(selected_event))
            }
          >
            {updating_event_id === selected_event.id
              ? 'Updating…'
              : selected_event.is_joined
                ? 'Leave Event'
                : can_join_event(selected_event)
                  ? 'Join Event'
                  : 'Members only'}
          </button> 
        {!selected_event.is_joined && !can_join_event(selected_event) && (
          <p className="message">
            {membership_error
              ? 'Could not verify your club memberships.'
              : 'You cannot join this event because it is for members only.'}
          </p>
        )}
        {participation_message && (
          <p className="message">{participation_message}</p>
        )}
        <button onClick={() => set_selected_event(null)}>Close details</button>  
        </section>  
      )}

    </main>
  )
}

export default EventsPage
