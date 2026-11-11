import { ApiError, addDays, campusDate, campusInstant } from './apiShared.js'

const slots = [
  { id: 'morning', start: '10:00', end: '12:00' },
  { id: 'afternoon', start: '13:00', end: '15:00' },
  { id: 'evening', start: '16:00', end: '18:00' },
]
const slotLabel = slot => `${slot.start} - ${slot.end}`
const membershipList = rows => rows.map(row => ({ ...row, club_name: row.name }))
const data = value => ({ data: value })

async function call(path, signal, method = 'GET', body) {
  let response
  try {
    response = await fetch(`/api${path}`, {
      signal, method, credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new ApiError('Unable to reach the server. Refresh before retrying a change.', 0, 'NETWORK_ERROR')
  }
  if (response.status === 204) return null
  const result = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(result?.message || `Request failed (${response.status}).`, response.status, undefined, {}, response.headers.get('Retry-After'))
  }
  if (result == null) throw new ApiError('The server returned an invalid response.', response.status, 'INVALID_RESPONSE')
  return result
}

function page(rows, params, extra = {}) {
  const page = Number(params.get('page')) || 1
  const page_size = Number(params.get('page_size')) || 20
  return {
    data: rows.slice((page - 1) * page_size, page * page_size),
    meta: { page, page_size, total: rows.length, ...extra },
  }
}

function eventResource(row, memberships = []) {
  const [start, end] = row.timeslot.split(' - ')
  const start_at = campusInstant(row.date, start)
  const end_at = campusInstant(end <= start ? addDays(row.date, 1) : row.date, end)
  const visibility = row.visibility === 'Members only' ? 'members_only' : 'public'
  const started = new Date(start_at) <= new Date()
  const registration = row.registration_status || row.participation_status
  const status = row.event_status === 'cancelled' && ['joined', 'pending', 'waitlisted'].includes(registration)
    ? 'unsuccessful'
    : ['pending', 'waitlisted'].includes(registration) ? 'pending'
      : ['left', 'cancelled'].includes(registration) ? 'unsuccessful'
        : registration || 'none'
  const reason = row.event_status === 'cancelled' ? 'EVENT_CANCELLED'
    : started ? 'REGISTRATION_CLOSED'
    : visibility === 'members_only' && !memberships.some(membership => membership.club_id === row.club_id) ? 'MEMBERSHIP_REQUIRED'
    : ['joined', 'pending'].includes(status) ? 'ALREADY_REGISTERED'
    : row.is_full ? 'EVENT_FULL' : null
  return {
    ...row,
    club: { id: row.club_id, name: row.club },
    venue: { id: row.venue_id, name: row.venue },
    start_at, end_at, visibility,
    state: row.event_status,
    phase: started ? 'past' : 'upcoming',
    booking: { status: row.booking_status },
    my_registration: { status },
    eligibility: { can_register: !reason, can_waitlist: reason === 'EVENT_FULL', reason },
  }
}

const visibilityLabel = value => value === 'members_only' ? 'Members only' : 'Public'

export async function requestMainBackend(path, { method = 'GET', body, signal } = {}) {
  const { pathname, searchParams } = new URL(path, 'http://clubspace.local')
  const get = path => call(path, signal)
  const send = (path, payload, verb = method) => call(path, signal, verb, payload)
  const session = async user => data({ user, memberships: membershipList(await get('/memberships')) })
  const eventMatch = pathname.match(/^\/events\/(\d+)(?:\/(registration|participants|cancel))?$/)
  const clubMatch = pathname.match(/^\/clubs\/(\d+)\/membership$/)
  const committeeMatch = pathname.match(/^\/clubs\/(\d+)\/committee$/)
  const clubMembersMatch = pathname.match(/^\/clubs\/(\d+)\/members$/)
  const clubMemberMatch = pathname.match(/^\/clubs\/(\d+)\/members\/(\d+)$/)
  const clubMemberCommitteeMatch = pathname.match(/^\/clubs\/(\d+)\/members\/(\d+)\/committee$/)
  const clubActionsMatch = pathname.match(/^\/clubs\/(\d+)\/actions$/)
  const clubActionUndoMatch = pathname.match(/^\/clubs\/(\d+)\/actions\/(\d+)\/undo$/)
  const presidencyMatch = pathname.match(/^\/clubs\/(\d+)\/presidency$/)
  const joinRequestReviewMatch = pathname.match(/^\/clubs\/(\d+)\/join-requests\/(\d+)\/review$/)
  const calendarMatch = pathname.match(/^\/venues\/(\d+)\/calendar$/)

  if (pathname === '/auth/session') return session(await get('/auth/me'))
  if (pathname === '/auth/login' || pathname === '/auth/register') return session(await send(pathname, body))
  if (pathname === '/auth/logout') return data(await send(pathname))
  if (pathname === '/profile') {
    return data(await (method === 'GET' ? get('/auth/me') : send('/auth/me', body, 'PUT')))
  }
  if (pathname === '/clubs') return page(await get('/clubs'), searchParams)
  if (pathname === '/me/memberships') return page(membershipList(await get('/memberships')), searchParams)
  if (clubMatch) return data(await send(pathname, body, method === 'PUT' ? 'POST' : method))
  if (committeeMatch && method === 'DELETE') return data(await send(pathname))
  if (clubMembersMatch && method === 'GET') return data(await get(pathname))
  if (clubMemberMatch && method === 'DELETE') return data(await send(pathname))
  if (clubMemberCommitteeMatch && method === 'POST') return data(await send(pathname))
  if (clubMemberCommitteeMatch && method === 'DELETE') return data(await send(pathname))
  if (clubActionsMatch && method === 'GET') {
    const actions = await get(pathname)
    return data(actions.map(action => ({
      ...action,
      created_at: new Date(Number(action.created_epoch) * 1000).toISOString(),
    })))
  }
  if (clubActionUndoMatch && method === 'POST') return data(await send(pathname))
  if (presidencyMatch && method === 'POST') return data(await send(pathname, body))
  if (joinRequestReviewMatch && method === 'POST') return data(await send(pathname, body))
  if (pathname === '/config') return data({ campus_timezone: 'Asia/Hong_Kong', slots })
  if (pathname === '/venues') {
    const venues = await get('/venues')
    return page(venues.map(venue => ({ ...venue, is_active: true })), searchParams)
  }
  if (calendarMatch) {
    const from = campusDate(new Date(searchParams.get('from')))
    const days = Array.from({ length: 7 }, (_, index) => addDays(from, index))
    const availability = await Promise.all(days.map(date => get(`/venues?date=${date}`)))
    const bookings = availability.flatMap((venues, index) => {
      const venue = venues.find(venue => venue.id === Number(calendarMatch[1]))
      if (!venue) throw new ApiError('Venue not found.', 404, 'NOT_FOUND')
      return venue.timeslots.filter(slot => !slot.available).map(slot => {
        const [start, end] = slot.time.split(' - ')
        return { busy: true, start_at: campusInstant(days[index], start), end_at: campusInstant(days[index], end) }
      })
    })
    return data({ bookings })
  }
  if (pathname === '/events' && method === 'POST') {
    const [memberships, venues] = await Promise.all([get('/memberships'), get('/venues')])
    const club = memberships.find(club => club.club_id === body.club_id)
    const venue = venues.find(venue => venue.id === body.venue_id)
    const slot = slots.find(slot => slot.id === body.slot_id)
    if (!club || !venue || !slot) throw new ApiError('Select a valid club, venue, and slot.', 422, 'VALIDATION_FAILED')
    return data(await send(pathname, {
      club: club.name, venue: venue.name, timeslot: slotLabel(slot), date: body.date,
      title: body.title, description: body.description, visibility: visibilityLabel(body.visibility),
    }))
  }
  if (pathname === '/events' || pathname === '/me/events') {
    const managed = pathname === '/me/events'
    const phase = searchParams.get('phase')
    const state = searchParams.get('state')
    const clubId = searchParams.get('club_id')
    const venueId = searchParams.get('venue_id')
    const visibility = searchParams.get('visibility')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const search = searchParams.get('q')?.trim().toLowerCase()
    const events = await get(managed ? '/events?managed=true' : '/events')
    return page(events.map(row => eventResource(row)).filter(event =>
      (!phase || event.phase === phase) && (!state || event.state === state)
      && (!clubId || String(event.club.id) === clubId)
      && (!venueId || String(event.venue.id) === venueId)
      && (!visibility || event.visibility === visibility)
      && (!from || new Date(event.start_at) >= new Date(from))
      && (!to || new Date(event.start_at) < new Date(to))
      && (!search || [event.title, event.description, event.club.name, event.venue.name]
        .some(value => value?.toLowerCase().includes(search))),
    ), searchParams)
  }
  if (pathname === '/me/registrations') {
    const status = searchParams.get('status')
    const rows = await get('/events/mine')
    return page(rows.map(row => {
      const event = eventResource(row)
      return { event, status: event.my_registration.status }
    }).filter(registration => !status || registration.status === status), searchParams)
  }
  if (eventMatch) {
    const eventPath = `/events/${eventMatch[1]}`
    const action = eventMatch[2]
    if (action === 'registration') return data(await send(`${eventPath}/participation`, body))
    if (action === 'cancel') return data(await send(eventPath, undefined, 'DELETE'))
    if (action === 'participants') {
      const status = searchParams.get('status')
      const rows = await get(pathname)
      return page(rows.filter(row => !status || row.status === status).map(row => ({
        ...row, user: { id: row.user_id, name: row.name },
      })), searchParams)
    }
    if (method === 'PATCH') {
      return data(await send(eventPath, body))
    }
    const [row, memberships] = await Promise.all([get(eventPath), get('/memberships')])
    return data(eventResource(row, memberships))
  }
  if (pathname === '/notifications') {
    const unreadOnly = searchParams.get('unread_only') === 'true'
    const rows = await get(pathname)
    return page(rows.filter(row => !unreadOnly || !row.read_at).map(row => ({
      ...row,
      title: row.event_title,
      body: row.message,
      type: row.club_join_request_id ? 'club_join_request' : row.club_id ? 'club_membership' : 'event',
      join_request_id: row.club_join_request_id,
      created_at: new Date(Number(row.created_epoch) * 1000).toISOString(),
    })), searchParams, { unread_count: rows.filter(row => !row.read_at).length })
  }
  if (/^\/notifications\/\d+\/read$/.test(pathname)) return data(await send(pathname))
  throw new ApiError('This workflow requires the ClubSpace v1 provider.', 501, 'WORKFLOW_UNAVAILABLE')
}
