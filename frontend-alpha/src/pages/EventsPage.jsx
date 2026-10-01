import { useState, useEffect } from 'react'
import { NavLink } from 'react-router'
import '../App.css'

function EventsPage({ student_clubs }) {
  const [search_term, set_search_term] = useState('')
  const [selected_event, set_selected_event] = useState(null)
  const [joined_events, set_joined_events] = useState([])
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
      return student_clubs.includes(event.club)
    }
    return false
  }

  function toggle_join_event(event) {
    if (!can_join_event(event)) {
      alert('You cannot join this event because it is for members only.')
      return
    }
    set_joined_events((prev_joined_events) => {
      if (prev_joined_events.includes(event.id)) {
        return prev_joined_events.filter((id) => id !== event.id)
      } else {
        return [...prev_joined_events, event.id]
      }
    })
  }

  return (
    <main>
      <header> 
        <h1> ClubSpace </h1>
        <nav>
        <NavLink to="/events">Events</NavLink>
        <NavLink to="/profile">Profile</NavLink>
        <NavLink to="/venues">Venues</NavLink>        </nav>
      </header>
      <section>
        <p> Event Search </p>
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
          <button onClick={() => toggle_join_event(selected_event)} disabled = {!can_join_event(selected_event)}>
            {!can_join_event(selected_event) ? 'Members only' : joined_events.includes(selected_event.id) ? 'Leave Event' : 'Join Event'}
          </button> 
        {!can_join_event(selected_event) && (
          <p className="message">
            You cannot join this event because it is for members only.
          </p>
        )}          
        <button onClick={() => set_selected_event(null)}>Close details</button>  
        </section>  
      )}

    </main>
  )
}

export default EventsPage
