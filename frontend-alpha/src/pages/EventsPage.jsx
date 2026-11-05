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
  const [date_from_filter, set_date_from_filter] = useState('')
  const [date_to_filter, set_date_to_filter] = useState('')
  const [visibility_filter, set_visibility_filter] = useState('')
  const [club_filter, set_club_filter] = useState('')
  const [venue_filter, set_venue_filter] = useState('')
  const [events, set_events] = useState([])
  const [notifications, set_notifications] = useState([])
  const [notification_error, set_notification_error] = useState('')
  const [cancelling_event_id, set_cancelling_event_id] = useState(null)
  const [editing_event_id, set_editing_event_id] = useState(null)
  const [edit_form, set_edit_form] = useState(null)
  const [edit_venues, set_edit_venues] = useState([])
  const [edit_venues_error, set_edit_venues_error] = useState('')
  const [saving_event_edit, set_saving_event_edit] = useState(false)
  const [participants_by_event, set_participants_by_event] = useState({})
  const [participants_loading, set_participants_loading] = useState(false)
  const [participants_error, set_participants_error] = useState('')
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
              ? next_events.find((event) => event.id === current.id) || null
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

  useEffect(() => {
    if (account_state !== 'signed_in') {
      return undefined
    }

    let active = true
    async function refresh_notifications() {
      try {
        const response = await fetch('/api/notifications')
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.message || 'Could not load notifications.')
        }
        if (active) {
          set_notifications(data)
          set_notification_error('')
        }
      } catch (error) {
        if (active) {
          set_notification_error(
            error.message || 'Could not load notifications.',
          )
        }
      }
    }

    refresh_notifications()
    const interval = window.setInterval(refresh_notifications, 15000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [account_state])

  useEffect(() => {
    if (!editing_event_id || !edit_form?.date) return undefined

    let active = true
    async function load_edit_venues() {
      try {
        const response = await fetch(
          `/api/venues?date=${encodeURIComponent(edit_form.date)}`,
        )
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.message || 'Could not load venues.')
        }
        if (active) {
          set_edit_venues(data)
          set_edit_venues_error('')
        }
      } catch (error) {
        if (active) {
          set_edit_venues_error(error.message || 'Could not load venues.')
        }
      }
    }

    load_edit_venues()
    return () => {
      active = false
    }
  }, [editing_event_id, edit_form?.date])
  
  const event_clubs = [...new Set(events.map((event) => event.club))].sort()
  const event_venues = [...new Set(events.map((event) => event.venue))].sort()
  const visible_events = events.filter((event) => {
    const searchable_text = `${event.title} ${event.club} ${event.venue} ${event.description}`.toLowerCase()
    return (
      searchable_text.includes(search_term.toLowerCase()) &&
      event.status === event_status_filter &&
      (!date_from_filter || event.date >= date_from_filter) &&
      (!date_to_filter || event.date <= date_to_filter) &&
      (!visibility_filter || event.visibility === visibility_filter) &&
      (!club_filter || event.club === club_filter) &&
      (!venue_filter || event.venue === venue_filter)
    )
  })

  function clear_discovery_filters() {
    set_search_term('')
    set_date_from_filter('')
    set_date_to_filter('')
    set_visibility_filter('')
    set_club_filter('')
    set_venue_filter('')
  }

  function can_join_event(event) {
    if (event.visibility === 'Public') {
      return true
    } else if (event.visibility === 'Members only') {
      return !membership_error && student_clubs.includes(event.club)
    }
    return false
  }

  async function mark_notification_as_read(notification) {
    try {
      const response = await fetch(
        `/api/notifications/${notification.id}/read`,
        { method: 'PATCH' },
      )
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Could not update notification.')
      }
      set_notifications((current) =>
        current.map((item) =>
          item.id === notification.id
            ? { ...item, read_at: new Date().toISOString() }
            : item,
        ),
      )
    } catch (error) {
      set_notification_error(error.message || 'Could not update notification.')
    }
  }

  async function load_event_participants(event_id) {
    set_participants_loading(true)
    set_participants_error('')
    try {
      const response = await fetch(`/api/events/${event_id}/participants`)
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.message || 'Could not load event participants.')
      }
      set_participants_by_event((current) => ({
        ...current,
        [event_id]: data,
      }))
    } catch (error) {
      set_participants_error(
        error.message || 'Could not load event participants.',
      )
    } finally {
      set_participants_loading(false)
    }
  }

  async function cancel_event(event) {
    if (
      !window.confirm(
        `Cancel "${event.title}"? All signed-up users will be notified and the venue booking will be released.`,
      )
    ) {
      return
    }

    set_cancelling_event_id(event.id)
    set_participation_message('')
    try {
      const response = await fetch(`/api/events/${event.id}`, {
        method: 'DELETE',
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.message || 'Could not cancel event.')
      }
      set_selected_event(null)
      set_participation_message(data.message)
      set_participation_message_type('success')

      const [events_response, notifications_response] = await Promise.all([
        fetch('/api/events'),
        fetch('/api/notifications'),
      ])
      if (!events_response.ok || !notifications_response.ok) {
        throw new Error(
          'The event was cancelled, but the page could not refresh all details.',
        )
      }
      set_events(await events_response.json())
      set_notifications(await notifications_response.json())
      set_notification_error('')
    } catch (error) {
      set_participation_message(
        error.message || 'Could not reach the server.',
      )
      set_participation_message_type('error')
    } finally {
      set_cancelling_event_id(null)
    }
  }

  function start_editing_event(event) {
    set_editing_event_id(event.id)
    set_edit_form({
      title: event.title,
      description: event.description || '',
      date: event.date,
      venue: event.venue,
      timeslot: event.timeslot,
      visibility: event.visibility,
    })
    set_edit_venues([])
    set_edit_venues_error('')
    set_participation_message('')
  }

  async function save_event_edit(event) {
    set_saving_event_edit(true)
    set_participation_message('')
    try {
      const response = await fetch(`/api/events/${event.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(edit_form),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.message || 'Could not update event.')
      }

      set_editing_event_id(null)
      set_edit_form(null)
      set_participation_message(data.message)
      set_participation_message_type('success')
      const [events_response, notifications_response] = await Promise.all([
        fetch('/api/events'),
        fetch('/api/notifications'),
      ])
      if (!events_response.ok || !notifications_response.ok) {
        throw new Error(
          'Event updated, but refreshed event details or notifications could not be loaded.',
        )
      }
      const [updated_events, updated_notifications] = await Promise.all([
        events_response.json(),
        notifications_response.json(),
      ])
      set_events(updated_events)
      set_selected_event(
        updated_events.find((updated_event) => updated_event.id === event.id) ||
          null,
      )
      set_notifications(updated_notifications)
      set_notification_error('')
    } catch (error) {
      set_participation_message(
        error.message || 'Could not reach the server.',
      )
      set_participation_message_type('error')
    } finally {
      set_saving_event_edit(false)
    }
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
          placeholder="Search event title, club, venue, or description"
          value={search_term}
          onChange={(e) => set_search_term(e.target.value)}
        /> 
      </section>  
      <section className="event-filters" aria-label="Event discovery filters">
        <h2>Filter events</h2>
        <div className="event-filter-grid">
          <label>
            From date
            <input
              type="date"
              value={date_from_filter}
              max={date_to_filter || undefined}
              onChange={(event) => set_date_from_filter(event.target.value)}
            />
          </label>
          <label>
            To date
            <input
              type="date"
              value={date_to_filter}
              min={date_from_filter || undefined}
              onChange={(event) => set_date_to_filter(event.target.value)}
            />
          </label>
          <label>
            Visibility
            <select
              value={visibility_filter}
              onChange={(event) => set_visibility_filter(event.target.value)}
            >
              <option value="">All visibilities</option>
              <option value="Public">Public</option>
              <option value="Members only">Members only</option>
            </select>
          </label>
          <label>
            Club
            <select
              value={club_filter}
              onChange={(event) => set_club_filter(event.target.value)}
            >
              <option value="">All clubs</option>
              {event_clubs.map((club) => (
                <option key={club} value={club}>{club}</option>
              ))}
            </select>
          </label>
          <label>
            Venue
            <select
              value={venue_filter}
              onChange={(event) => set_venue_filter(event.target.value)}
            >
              <option value="">All venues</option>
              {event_venues.map((venue) => (
                <option key={venue} value={venue}>{venue}</option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="button"
          className="secondary-button clear-event-filters"
          onClick={clear_discovery_filters}
        >
          Clear discovery filters
        </button>
      </section>
      {account_state === 'signed_in' && (
        <section className="panel notifications-panel" aria-label="Notifications">
          <h2>Notifications</h2>
          {notification_error && (
            <p className="message error-message" role="alert">
              {notification_error}
            </p>
          )}
          {notifications.length === 0 && !notification_error && (
            <p>No notifications.</p>
          )}
          {notifications.map((notification) => (
            <div
              className={`notification ${notification.read_at ? '' : 'unread'}`}
              key={notification.id}
            >
              <div>
                <strong>{notification.event_title}</strong>
                <p>{notification.message}</p>
                <small>
                  {new Date(notification.created_at).toLocaleString()}
                </small>
              </div>
              {!notification.read_at && (
                <button
                  type="button"
                  className="notification-read-button"
                  onClick={() => mark_notification_as_read(notification)}
                >
                  Mark as read
                </button>
              )}
            </div>
          ))}
        </section>
      )}
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
          {selected_event.can_cancel && (
            <details
              className="event-participants"
              onToggle={(toggle_event) => {
                if (toggle_event.currentTarget.open) {
                  load_event_participants(selected_event.id)
                }
              }}
            >
              <summary>View participants</summary>
              {participants_loading && <p>Loading participants…</p>}
              {participants_error && (
                <div className="message error-message" role="alert">
                  <p>{participants_error}</p>
                  <button
                    type="button"
                    onClick={() => load_event_participants(selected_event.id)}
                  >
                    Try again
                  </button>
                </div>
              )}
              {participants_by_event[selected_event.id]?.length === 0 && (
                <p>No one has signed up for this event.</p>
              )}
              {(participants_by_event[selected_event.id] || []).map(
                (participant) => (
                  <div
                    className="row"
                    key={`${selected_event.id}:${participant.user_id}`}
                  >
                    <span>
                      {participant.name}
                      <span className="membership-role">
                        {' · '}
                        {participant.status === 'waitlisted'
                          ? 'Waitlisted'
                          : 'Joined'}
                        {' · '}
                        {new Date(participant.joined_at).toLocaleString()}
                      </span>
                    </span>
                  </div>
                ),
              )}
            </details>
          )}
          {selected_event.is_full && (
            <p className="badge full-badge" role="status">Event full</p>
          )}
          {selected_event.can_cancel && (
            <>
              {editing_event_id !== selected_event.id && (
                <button
                  type="button"
                  onClick={() => start_editing_event(selected_event)}
                >
                  Edit event
                </button>
              )}
              <button
                type="button"
                className="cancel-button"
                disabled={cancelling_event_id === selected_event.id}
                onClick={() => cancel_event(selected_event)}
              >
                {cancelling_event_id === selected_event.id
                  ? 'Cancelling…'
                  : 'Cancel event'}
              </button>
            </>
          )}
          {editing_event_id === selected_event.id && edit_form && (
            <form
              className="event-edit-form"
              onSubmit={(submit_event) => {
                submit_event.preventDefault()
                save_event_edit(selected_event)
              }}
            >
              <h3>Edit event</h3>
              <label>
                Event title
                <input
                  required
                  maxLength={255}
                  value={edit_form.title}
                  onChange={(change_event) =>
                    set_edit_form((current) => ({
                      ...current,
                      title: change_event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Description
                <textarea
                  required
                  value={edit_form.description}
                  onChange={(change_event) =>
                    set_edit_form((current) => ({
                      ...current,
                      description: change_event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Date
                <input
                  required
                  type="date"
                  value={edit_form.date}
                  onChange={(change_event) =>
                    set_edit_form((current) => ({
                      ...current,
                      date: change_event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Venue
                <select
                  required
                  value={edit_form.venue}
                  onChange={(change_event) =>
                    set_edit_form((current) => ({
                      ...current,
                      venue: change_event.target.value,
                    }))
                  }
                >
                  {edit_venues.map((venue) => (
                    <option key={venue.id} value={venue.name}>
                      {venue.name} ({venue.capacity} seats)
                    </option>
                  ))}
                </select>
              </label>
              {edit_venues_error && (
                <p className="message error-message" role="alert">
                  {edit_venues_error}
                </p>
              )}
              <label>
                Timeslot
                <select
                  required
                  value={edit_form.timeslot}
                  onChange={(change_event) =>
                    set_edit_form((current) => ({
                      ...current,
                      timeslot: change_event.target.value,
                    }))
                  }
                >
                  {['10:00 - 12:00', '13:00 - 15:00', '16:00 - 18:00'].map(
                    (timeslot) => (
                      <option key={timeslot}>{timeslot}</option>
                    ),
                  )}
                </select>
              </label>
              <label>
                Visibility
                <select
                  value={edit_form.visibility}
                  onChange={(change_event) =>
                    set_edit_form((current) => ({
                      ...current,
                      visibility: change_event.target.value,
                    }))
                  }
                >
                  <option>Public</option>
                  <option>Members only</option>
                </select>
              </label>
              <button type="submit" disabled={saving_event_edit}>
                {saving_event_edit ? 'Saving…' : 'Save event changes'}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={saving_event_edit}
                onClick={() => {
                  set_editing_event_id(null)
                  set_edit_form(null)
                  set_edit_venues_error('')
                }}
              >
                Cancel editing
              </button>
            </form>
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
