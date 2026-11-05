// Read-only local preview data. This module is loaded only by `npm run dev:fixtures`.
const token = 'local-preview-token'
const user = { id: 1, name: 'Alex Chan', email: 'preview@clubspace.test', student_id: 'PREVIEW-01', platform_role: 'venue_admin' }
const memberships = [{ club_id: 1, club_name: 'Photography Society', role: 'committee', joined_at: '2026-01-01T00:00:00Z' }]
const session = { user, memberships, csrf_token: token }
const venues = [{ id: 1, name: 'Harbour Room', location: 'Student Centre · Level 2', description: 'A flexible space for workshops and club gatherings.', capacity: 80, is_active: true }, { id: 2, name: 'The Studio', location: 'Arts Building · Level 1', description: 'A bright space for creative sessions and small events.', capacity: 40, is_active: true }]
const clubs = [{ id: 1, name: 'Photography Society', description: 'A community for people who love making images.', my_role: 'committee' }, { id: 2, name: 'Film Society', description: 'Screenings and conversations for film lovers.', my_role: null }]
const slots = [{ id: 'morning', start: '10:00', end: '12:00' }, { id: 'afternoon', start: '13:00', end: '15:00' }, { id: 'evening', start: '16:00', end: '18:00' }]
const future = days => new Date(Date.now() + days * 86400000).toISOString()
const events = [
  { id: 1, title: 'Campus photo walk', description: 'Explore campus and share photography tips with fellow students.', club: { id: 1, name: 'Photography Society' }, venue: venues[0], start_at: future(7), end_at: future(7.08), registration_closes_at: future(6), visibility: 'public', state: 'published', phase: 'upcoming', version: 1, capacity: 30, joined_count: 18, waitlisted_count: 0, my_registration: { status: 'none', queue_position: null }, eligibility: { can_register: true, can_waitlist: false, reason: null }, booking: { id: 1, status: 'confirmed', version: 1, expired: false, decision_reason: null } },
  { id: 2, title: 'Film night: stories in motion', description: 'A relaxed evening of short films and conversation.', club: { id: 2, name: 'Film Society' }, venue: venues[1], start_at: future(14), end_at: future(14.08), registration_closes_at: future(13), visibility: 'public', state: 'published', phase: 'upcoming', version: 1, capacity: 40, joined_count: 32, waitlisted_count: 0, my_registration: { status: 'none', queue_position: null }, eligibility: { can_register: true, can_waitlist: false, reason: null }, booking: { id: 2, status: 'confirmed', version: 1, expired: false, decision_reason: null } },
]
// Additional states are available by direct event URL in the local preview.
events.push(
  { ...events[0], id: 3, title: 'Workshop waitlist', joined_count: 30, waitlisted_count: 4, eligibility: { can_register: false, can_waitlist: true, reason: 'EVENT_FULL' } },
  { ...events[0], id: 4, title: 'Registration closed', registration_closes_at: future(-1), eligibility: { can_register: false, can_waitlist: false, reason: 'REGISTRATION_CLOSED' } },
  { ...events[0], id: 5, title: 'Cancelled gathering', state: 'cancelled', joined_count: 0, waitlisted_count: 0, eligibility: { can_register: false, can_waitlist: false, reason: 'EVENT_CANCELLED' }, my_registration: { status: 'cancelled', queue_position: null } },
  { ...events[0], id: 6, title: 'Members-only gathering', club: { id: 2, name: 'Film Society' }, visibility: 'members_only', eligibility: { can_register: false, can_waitlist: false, reason: 'MEMBERSHIP_REQUIRED' } },
  { ...events[0], id: 7, title: 'Waitlisted student', joined_count: 30, waitlisted_count: 4, eligibility: { can_register: false, can_waitlist: false, reason: 'ALREADY_REGISTERED' }, my_registration: { status: 'waitlisted', queue_position: 2 } },
  { ...events[0], id: 8, title: 'A very long event title for students who want to explore photography, creative practice and community together', description: 'A detailed programme with a long title to exercise layout and text wrapping.' },
  { ...events[0], id: 9, title: 'Event and waitlist full', joined_count: 30, waitlisted_count: 500, eligibility: { can_register: false, can_waitlist: false, reason: 'WAITLIST_FULL' } },
  { ...events[0], id: 10, title: 'Joined event', my_registration: { status: 'joined', queue_position: null }, eligibility: { can_register: false, can_waitlist: false, reason: 'ALREADY_REGISTERED' } },
)
const bookingRequests = [
  { id: 11, event_id: 3, event_title: 'Student film showcase and conversation with emerging filmmakers', club_id: 2, venue_id: 2, start_at: future(12), end_at: future(12.08), status: 'pending', version: 1, expired: false },
  { id: 12, event_id: 4, event_title: 'Photography workshop', club_id: 1, venue_id: 1, start_at: future(15), end_at: future(15.08), status: 'pending', version: 1, expired: false },
]
const list = (data, extra = {}) => ({ data, meta: { page: 1, page_size: 100, total: data.length, ...extra } })
export function fixturePlugin() {
  return { name: 'clubspace-local-preview', configureServer(server) {
    server.middlewares.use('/api/v1', (req, res) => {
      const url = new URL(req.url, 'http://localhost')
      const send = (status, payload) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(payload)) }
      const fail = (status, code, message) => send(status, { error: { code, message, fields: {}, request_id: 'local-fixture' } })
      const signedIn = (req.headers.cookie || '').split(';').some(c => c.trim() === 'clubspace_preview=1')
      if (url.pathname === '/config' && req.method === 'GET') return send(200, { data: { campus_timezone: 'Asia/Hong_Kong', slots } })
      if (url.pathname === '/auth/csrf' && req.method === 'GET') return send(200, { data: { csrf_token: token } })
      if (url.pathname === '/auth/login' && req.method === 'POST') { let raw = ''; req.on('data', chunk => { raw += chunk }); req.on('end', () => { try { const body = JSON.parse(raw); if (body.email !== user.email || body.password !== 'preview12345') return fail(401, 'INVALID_CREDENTIALS', 'Invalid preview credentials.'); res.setHeader('Set-Cookie', 'clubspace_preview=1; HttpOnly; SameSite=Strict; Path=/'); send(200, { data: session }) } catch { fail(400, 'INVALID_JSON', 'Invalid request.') } }); return }
      if (url.pathname === '/auth/session' && req.method === 'GET') return signedIn ? send(200, { data: url.searchParams.get('preview') === 'student' ? { ...session, user: { ...user, platform_role: 'student' }, memberships: [] } : session }) : fail(401, 'AUTHENTICATION_REQUIRED', 'Sign in to the local preview.')
      if (!signedIn) return fail(401, 'AUTHENTICATION_REQUIRED', 'Sign in to the local preview.')
      if (url.pathname === '/auth/logout' && req.method === 'POST') { res.statusCode = 204; res.setHeader('Set-Cookie', 'clubspace_preview=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return res.end() }
      if (req.method !== 'GET') {
        if (/^\/bookings\/\d+\/decision$/.test(url.pathname)) return fail(409, 'VENUE_UNAVAILABLE', 'The venue is no longer available. Review the updated request before trying again.')
        return fail(503, 'PREVIEW_READ_ONLY', 'This is a read-only preview. Changes require the real backend.')
      }
      if (url.searchParams.get('preview') === 'error' && (/^\/clubs\/\d+\/reports$/.test(url.pathname) || url.pathname === '/bookings')) return fail(503, 'DATABASE_UNAVAILABLE', 'The preview could not load this data. Try again.')
      const empty = url.searchParams.get('preview') === 'empty'
      const id = url.pathname.match(/^\/events\/(\d+)$/)?.[1]
      if (id) { const event = events.find(e => e.id === Number(id)); return event ? send(200, { data: event }) : fail(404, 'NOT_FOUND', 'Event not found.') }
      if (/^\/events\/\d+\/participants$/.test(url.pathname)) return send(200, list([]))
      if (/^\/venues\/\d+\/calendar$/.test(url.pathname)) {
        const venueId = Number(url.pathname.split('/')[2])
        const from = url.searchParams.get('from'), to = url.searchParams.get('to')
        const start = new Date(from), end = new Date(to)
        if (!from || !to || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end || end - start > 31 * 86400000) return fail(422, 'VALIDATION_FAILED', 'Choose a valid calendar range of at most 31 days.')
        const booking = { start_at: future(1), end_at: future(1.1), busy: true, event_id: null, title: null, club_id: null }
        const bookings = venueId === 1 && new Date(booking.start_at) < end && new Date(booking.end_at) > start ? [booking] : []
        return send(200, { data: { venue_id: venueId, from, to, campus_timezone: 'Asia/Hong_Kong', bookings } })
      }
      if (/^\/clubs\/\d+\/reports$/.test(url.pathname)) {
        if (url.pathname !== '/clubs/1/reports') return fail(403, 'FORBIDDEN', 'Only committee members can view this report.')
        const from = url.searchParams.get('from'), to = url.searchParams.get('to')
        const start = new Date(from), end = new Date(to)
        if (!from || !to || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end || end - start > 93 * 86400000) return fail(422, 'VALIDATION_FAILED', 'Choose a valid report range of at most 93 days.')
        const now = new Date()
        const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(now)
        const included = !empty && new Date(from) <= now && now < new Date(to)
        const firstDay = new Date(new Date(from).getTime() + 8 * 3600000).toISOString().slice(0, 10)
        const lastDay = new Date(new Date(to).getTime() - 1 + 8 * 3600000).toISOString().slice(0, 10)
        const daily = []
        for (let cursor = firstDay; cursor <= lastDay;) {
          const active = included && cursor === date
          daily.push({ date: cursor, joined: active ? 4 : 0, waitlisted: active ? 1 : 0, left: active ? 1 : 0, promoted: 0, cancelled: 0 })
          const next = new Date(`${cursor}T00:00:00Z`)
          next.setUTCDate(next.getUTCDate() + 1)
          cursor = next.toISOString().slice(0, 10)
        }
        return send(200, { data: { club_id: 1, from, to, campus_timezone: 'Asia/Hong_Kong', events: included ? [{event_id:1,title:events[0].title,state:'published',capacity:30,joined_count:18,waitlisted_count:0}] : [], daily_actions: daily, venue_hours: included ? [{venue_id:1,venue_name:'Harbour Room',hours:2},{venue_id:2,venue_name:'The Studio for Photography and Creative Workshops',hours:1.5}] : [], history_complete_from: '2026-01-01T00:00:00Z' } })
      }
      const routes = { '/profile': { data: user }, '/clubs': list(clubs), '/me/memberships': list(empty ? [] : memberships), '/venues': list(venues), '/events': list(url.searchParams.get('phase') === 'past' ? [] : events.filter(e => e.state === 'published' && e.title.toLowerCase().includes((url.searchParams.get('q') || '').toLowerCase()))), '/me/events': list([events[0]]), '/me/registrations': list([]), '/bookings': list(empty ? [] : bookingRequests), '/notifications': list([], { unread_count: 0 }) }
      return routes[url.pathname] ? send(200, routes[url.pathname]) : fail(404, 'NOT_FOUND', 'This endpoint is not included in the preview.')
    })
  } }
}
