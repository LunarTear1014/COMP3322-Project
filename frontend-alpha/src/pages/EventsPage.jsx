import { useState } from 'react'
import { NavLink } from 'react-router'
import '../App.css'

const mock_events = [
  {
    id: 1,
    title: 'Photography Society Gathering',
    club: 'Photography Society',
    date: '6 Oct 18:30',
    venue: 'Happy Park',
    description: 'A casual photography walk for students interested in taking better campus photos.',
    visibility: 'Public',
    status: 'Upcoming',
    joined_count: 18,
  },
  {
    id: 2,
    title: 'Film Society Screening',
    club: 'Film Society',
    date: '2 Oct 18:30',
    venue: 'GoldenScene Cinema',
    description: 'Watch a selected film with other students, followed by a group discussion.',
    visibility: 'Members only',
    status: 'Upcoming',
    joined_count: 25,
  },
  {
    id: 3,
    title: 'Debate Club Meeting',
    club: 'Debate Club',
    date: '1 Oct 18:30',
    venue: 'Student Union',
    description: 'A practice debate for students who want to improve public-speaking skills.',
    visibility: 'Public',
    status: 'Past',
    joined_count: 12,
  },
]

function EventsPage({ student_clubs }) {
  const [search_term, set_search_term] = useState('')
  const [selected_event, set_selected_event] = useState(null)
  const [joined_events, set_joined_events] = useState([])
  const [event_status_filter, set_event_status_filter] = useState('Upcoming')
  
  const visible_events = mock_events.filter((event) => {
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
            <p>{event.date}</p>
            <p>{event.venue}</p>
            <button onClick={() => set_selected_event(event)}>View event</button>  
          </article>
        ))}
        {visible_events.length === 0 && <p>No events found</p>}
        
      </section>  
      {selected_event && (
        <section className="panel">
          <p> Event Details </p>
          <h4>{selected_event.title}</h4>
          <p>Date: {selected_event.date}</p>
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
