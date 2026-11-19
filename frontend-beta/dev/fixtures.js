// Read-only local preview data. This module is loaded only by `npm run dev:fixtures`.
const token = 'local-preview-token'
const user = { id: 1, name: 'Alex Chan', email: 'preview@clubspace.test', student_id: 'PREVIEW-01', platform_role: 'venue_admin' }
const memberships = [{ club_id: 1, club_name: 'Photography Society', role: 'committee', joined_at: '2026-01-01T00:00:00Z' }]
const session = { user, memberships, csrf_token: token }
const venues = [{ id: 1, name: 'Harbour Room', location: 'Student Centre · Level 2', description: 'A flexible space for workshops and club gatherings.', capacity: 80, is_active: true }, { id: 2, name: 'The Studio', location: 'Arts Building · Level 1', description: 'A bright space for creative sessions and small events.', capacity: 40, is_active: true }]
const clubs = [{ id: 1, name: 'Photography Society', description: 'A community for people who love making images.', my_role: 'committee' }, { id: 2, name: 'Film Society', description: 'Screenings and conversations for film lovers.', my_role: null }]
clubs.push(
  { id: 3, name: '攝影 Chess & Strategy', description: 'Board games, puzzles and friendly tournaments.', my_role: 'member' },
  { id: 4, name: 'Hiking Club', description: 'Weekend trails around the New Territories.', my_role: null },
  { id: 5, name: 'Robotics Lab', description: 'Build, break and rebuild.', my_role: null },
)
const slots = [{ id: 'early_morning', name: 'Early morning', start: '06:00', end: '08:00' }, { id: 'morning', name: 'Morning', start: '10:00', end: '12:00' }, { id: 'afternoon', name: 'Afternoon', start: '13:00', end: '15:00' }, { id: 'evening', name: 'Evening', start: '16:00', end: '18:00' }, { id: 'night', name: 'Night', start: '19:00', end: '21:00' }, { id: 'full_day', name: 'Full day', start: '09:00', end: '18:00' }]
const future = days => new Date(Date.now() + days * 86400000).toISOString()
const events = [
  { id: 1, title: 'Campus photo walk', description: 'Explore campus and share photography tips with fellow students.\n\nWhat happens:\n- First 15 minutes: meet at Harbour Room and swap quick tips on light and framing.\n- Main block: a slow walk around campus with stops for portraits, architecture and small details.\n- Last 20 minutes: share favourite shots and pick one to post.\n\nOpen to everyone, beginners included. Any camera works and phones are welcome. Wear comfortable shoes and bring water and a light jacket. Free to join, 30 places. Check in with the committee at the meeting point, and cancel early if you cannot come so the waitlist can move.', club: { id: 1, name: 'Photography Society' }, venue: venues[0], start_at: future(7), end_at: future(7.08), registration_closes_at: future(6), visibility: 'public', state: 'published', phase: 'upcoming', version: 1, capacity: 30, joined_count: 18, waitlisted_count: 0, my_registration: { status: 'none', queue_position: null }, eligibility: { can_register: true, can_waitlist: false, reason: null }, booking: { id: 1, status: 'confirmed', version: 1, expired: false, decision_reason: null } },
  { id: 2, title: 'Film night: stories in motion', description: 'A relaxed evening of short films and conversation.\n\nPlan:\n- Doors open 15 minutes early with seating first come, first served.\n- A programme of short films from around the world, with a short interval.\n- About 30 minutes of friendly discussion afterwards, led by the committee.\n\nOpen to everyone, no film background needed. Bring a light layer because the room can be cool, and silence your phone. Free entry, 40 places. If the event fills up, join the waitlist and arrive on time, as unclaimed seats are released at the start.', club: { id: 2, name: 'Film Society' }, venue: venues[1], start_at: future(14), end_at: future(14.08), registration_closes_at: future(13), visibility: 'public', state: 'published', phase: 'upcoming', version: 1, capacity: 40, joined_count: 32, waitlisted_count: 0, my_registration: { status: 'none', queue_position: null }, eligibility: { can_register: true, can_waitlist: false, reason: null }, booking: { id: 2, status: 'confirmed', version: 1, expired: false, decision_reason: null } },
]
// Additional states are available by direct event URL in the local preview.
events.push(
  { ...events[0], id: 3, title: 'Workshop waitlist', joined_count: 30, waitlisted_count: 4, eligibility: { can_register: false, can_waitlist: true, reason: 'EVENT_FULL' } },
  { ...events[0], id: 4, title: 'Registration closed', registration_closes_at: future(-1), eligibility: { can_register: false, can_waitlist: false, reason: 'REGISTRATION_CLOSED' } },
  { ...events[0], id: 5, title: 'Cancelled gathering', state: 'cancelled', joined_count: 0, waitlisted_count: 0, eligibility: { can_register: false, can_waitlist: false, reason: 'EVENT_CANCELLED' }, my_registration: { status: 'unsuccessful', queue_position: null } },
  { ...events[0], id: 6, title: 'Members-only gathering', club: { id: 2, name: 'Film Society' }, visibility: 'members_only', eligibility: { can_register: false, can_waitlist: false, reason: 'MEMBERSHIP_REQUIRED' } },
  { ...events[0], id: 7, title: 'Pending registration', joined_count: 30, waitlisted_count: 4, eligibility: { can_register: false, can_waitlist: false, reason: 'ALREADY_REGISTERED' }, my_registration: { status: 'pending', queue_position: 2 } },
  { ...events[0], id: 8, title: 'A very long event title for students who want to explore photography, creative practice and community together', description: 'A detailed programme with a long title to exercise layout and text wrapping.' },
  { ...events[0], id: 9, title: 'Event and waitlist full', joined_count: 30, waitlisted_count: 500, eligibility: { can_register: false, can_waitlist: false, reason: 'WAITLIST_FULL' } },
  { ...events[0], id: 10, title: 'Joined event', my_registration: { status: 'joined', queue_position: null }, eligibility: { can_register: false, can_waitlist: false, reason: 'ALREADY_REGISTERED' } },
)
// Covers are served by the preview as SVG art at the cover URL, standing in for uploaded WebP files.
const withCover = (event, alt) => ({ ...event, cover: { card_url: `/api/v1/events/${event.id}/cover/card?v=fixture`, full_url: `/api/v1/events/${event.id}/cover/full?v=fixture`, alt, width: 1200, height: 800, updated_at: '2026-11-10T08:00:00Z' } })
events[0] = withCover(events[0], 'Students walking across campus with cameras at golden hour')
events.push(
  { ...events[1], id: 11, title: 'Almost full board-game night', club: { id: 3, name: '攝影 Chess & Strategy' }, capacity: 20, joined_count: 18, venue: venues[1] },
  { ...events[0], id: 12, title: 'Sunrise hike to Lion Rock', club: { id: 4, name: 'Hiking Club' }, cover: null, capacity: 25, joined_count: 6 },
)
const pastEvent = { ...events[0], id: 13, title: 'Autumn exhibition opening', start_at: future(-9), end_at: future(-8.9), phase: 'past', cover: null, my_registration: { status: 'joined', queue_position: null } }
events.push(pastEvent)
// Organizer view: needs action (approved draft, rejected request), upcoming and past.
const organizerEvents = [
  { ...events[0], id: 21, title: 'Portrait workshop', state: 'draft', cover: null, joined_count: 0, booking: { id: 21, status: 'confirmed', version: 2, expired: false, decision_reason: null, decided_at: future(-1) } },
  { ...events[0], id: 22, title: 'Night photography meetup', state: 'draft', cover: null, joined_count: 0, booking: { id: 22, status: 'rejected', version: 2, expired: false, decision_reason: 'The room is closed for maintenance that day.', decided_at: future(-2) } },
  { ...events[0], id: 23, title: 'Pending darkroom session', state: 'draft', cover: null, joined_count: 0, booking: { id: 23, status: 'pending', version: 1, expired: false, decision_reason: null, decided_at: null } },
  events[0],
  { ...pastEvent, id: 24, club: { id: 1, name: 'Photography Society' } },
]
events.push(...organizerEvents.filter(event => event.id >= 21))
const byId = id => events.find(event => event.id === id)
const registration = (event, status, queue_position = null) => ({ event, status, queue_position, last_registered_at: future(-3), confirmed_at: status === 'joined' ? future(-3) : null, left_at: status === 'left' ? future(-1) : null })
const myRegistrations = [
  registration(byId(10), 'joined'),
  registration(byId(7), 'pending', 2),
  registration(byId(13), 'joined'),
  registration(byId(5), 'unsuccessful'),
  registration({ ...byId(2), id: 14, title: 'Left a workshop', start_at: future(20), end_at: future(20.08) }, 'left'),
]
const campusTags = [['academic','Academic'],['arts','Arts'],['career','Career'],['culture','Culture'],['free-food','Free food'],['music','Music'],['social','Social'],['sports','Sports'],['tech','Tech'],['volunteering','Volunteering']].map(([slug, name], index) => ({ id: index + 1, slug, name }))
const tagOf = slug => campusTags.find(tag => tag.slug === slug)
const clubTags = [{ id: 1, name: 'Beginners' }, { id: 2, name: 'Darkroom' }]
events.forEach((event, index) => { event.campus_tags = [tagOf(index % 3 === 0 ? 'arts' : index % 3 === 1 ? 'music' : 'social')]; event.club_tags = event.club?.id === 1 ? [clubTags[0]] : []; event.signoff = event.signoff ?? null })
organizerEvents.forEach(event => { event.campus_tags = event.campus_tags ?? [tagOf('arts')]; event.club_tags = event.club_tags ?? [] })
// Sign-off states for the president's queue and the committee's waiting and returned views.
const awaitingBooking = { id: 31, event_id: 31, event_title: 'Zine-making evening', club_id: 1, venue_id: 1, start_at: future(18), end_at: future(18.08), status: 'awaiting_president', version: 1, requested_by: 3, created_at: future(-1), decided_by: null, decided_at: null, decision_reason: null, expired: false, capacity: 20 }
const awaitingEvent = { ...events[0], id: 32, title: 'Spring portfolio show', state: 'awaiting_president', cover: null, joined_count: 0, signoff: { requested_by: 3, reason: null }, booking: { id: 32, status: 'confirmed', version: 2, expired: false, decision_reason: null, decided_at: future(-2) } }
const returnedEvent = { ...events[0], id: 33, title: 'Macro workshop', state: 'draft', cover: null, joined_count: 0, signoff: { requested_by: 3, reason: 'Please add a rain plan before publishing.' }, booking: { id: 33, status: 'confirmed', version: 2, expired: false, decision_reason: null, decided_at: future(-2) } }
const waitingBookingEvent = { ...events[0], id: 34, title: 'Street photo crawl', state: 'draft', cover: null, joined_count: 0, booking: { id: 34, status: 'awaiting_president', version: 1, expired: false, decision_reason: null, decided_at: null }, signoff: { requested_by: 3, reason: null } }
organizerEvents.push(awaitingEvent, returnedEvent, waitingBookingEvent)
events.push(awaitingEvent, returnedEvent, waitingBookingEvent)
const checkinEvent = { ...events[0], id: 35, title: 'Gallery walk tonight', start_at: future(0.01), end_at: future(0.09), phase: 'upcoming', cover: null, my_registration: { status: 'joined', queue_position: null }, eligibility: { can_register: false, can_waitlist: false, reason: 'ALREADY_REGISTERED' }, campus_tags: [tagOf('arts')], club_tags: [] }
events.push(checkinEvent)
// Members-only event with one member's request waiting for the committee.
const requestEvent = { ...events[0], id: 36, title: 'Darkroom open night', visibility: 'members_only', capacity: 12, joined_count: 4, pending_join_requests: 1, my_registration: { status: 'none', queue_position: null }, eligibility: { can_register: true, can_waitlist: false, requires_approval: false, reason: null }, campus_tags: [tagOf('arts')], club_tags: [] }
events.push(requestEvent)
const joinRequests = [{ user: { id: 5, name: 'Mei Lam', email: 'mei@example.test', student_id: 'S5' }, allow_waitlist: true, requested_at: future(-0.5) }]
const attendanceRecords = [{ event_id: 35, user_id: 3, method: 'code', checked_in_at: future(-0.01), marked_by: null, user: { id: 3, name: 'Riley Chen' } }]
const effectiveness = {
  club_id: 1, from: future(-30), to: future(1), campus_timezone: 'Asia/Hong_Kong',
  events: [
    { event_id: 1, title: 'Campus photo walk', start_at: future(-9), capacity: 30, joined_at_start: 26, fill_rate: 0.867, peak_waitlist: 4, ever_joined: 31, dropped_out: 5, dropout_rate: 0.161, checkin_recorded: true, attended: 21, turnout: 0.808, no_shows: 5, promotions: 3, median_promotion_wait_hours: 6.5, promoted_attended: 2, views: 240, unique_viewers: 150, views_by_source: { explore: 120, club: 40, inbox: 30, my_events: 10, share: 30, other: 10 }, view_to_join: 0.18, joins_24h_after_publish: 12 },
    { event_id: 36, title: 'Darkroom basics', start_at: future(-20), capacity: 12, joined_at_start: 9, fill_rate: 0.75, peak_waitlist: 0, ever_joined: 9, dropped_out: 0, dropout_rate: 0, checkin_recorded: false, attended: null, turnout: null, no_shows: null, promotions: 0, median_promotion_wait_hours: null, promoted_attended: null, views: 60, unique_viewers: 41, views_by_source: { explore: 30, club: 15, inbox: 5, my_events: 5, share: 5, other: 0 }, view_to_join: 0.22, joins_24h_after_publish: 5 },
  ],
  by_tag: [{ slug: 'arts', name: 'Arts', events: 2, avg_fill_rate: 0.81, avg_turnout: 0.808, too_few: true }],
  by_weekday: [{ weekday: 1, name: 'Monday', events: 2, avg_fill_rate: 0.81, avg_turnout: 0.808, too_few: true }],
  by_slot: [{ slot: 'afternoon', name: 'Afternoon', events: 2, avg_fill_rate: 0.81, avg_turnout: 0.808, too_few: true }],
}
const inbox = [
  { id: 31, type: 'event_published', event_id: 1, booking_id: null, title: 'New event: Campus photo walk', body: 'Photography Society just published Campus photo walk.', created_at: future(-0.01), read_at: null },
  { id: 30, type: 'booking_decided', event_id: 21, booking_id: 21, title: 'Venue request approved', body: 'Harbour Room is yours. Publish Portrait workshop when you are ready.', created_at: future(-1), read_at: null },
  { id: 29, type: 'registration_changed', event_id: 10, booking_id: null, title: 'You joined Joined event', body: 'You are going to Joined event.', created_at: future(-2), read_at: null },
  { id: 28, type: 'event_reminder', event_id: 10, booking_id: null, title: 'Tomorrow: Joined event', body: 'Starts tomorrow at 13:00.', created_at: future(-5), read_at: future(-4) },
]
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
      if (url.pathname === '/auth/session' && req.method === 'GET') return signedIn ? send(200, { data: url.searchParams.get('preview') === 'student' ? { ...session, user: { ...user, platform_role: 'student' }, memberships: [] } : url.searchParams.get('preview') === 'president' ? { ...session, user: { ...user, platform_role: 'student' }, memberships: [{ ...memberships[0], role: 'president' }] } : session }) : fail(401, 'AUTHENTICATION_REQUIRED', 'Sign in to the local preview.')
      if (!signedIn) return fail(401, 'AUTHENTICATION_REQUIRED', 'Sign in to the local preview.')
      if (url.pathname === '/auth/logout' && req.method === 'POST') { res.statusCode = 204; res.setHeader('Set-Cookie', 'clubspace_preview=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return res.end() }
      if (req.method !== 'GET') {
        if (/^\/bookings\/\d+\/decision$/.test(url.pathname)) return fail(409, 'VENUE_UNAVAILABLE', 'The venue is no longer available. Review the updated request before trying again.')
        return fail(503, 'PREVIEW_READ_ONLY', 'This is a read-only preview. Changes require the real backend.')
      }
      if (url.searchParams.get('preview') === 'error' && (/^\/clubs\/\d+\/reports$/.test(url.pathname) || url.pathname === '/bookings')) return fail(503, 'DATABASE_UNAVAILABLE', 'The preview could not load this data. Try again.')
      const empty = url.searchParams.get('preview') === 'empty'
      const cover = url.pathname.match(/^\/events\/(\d+)\/cover\/(card|full)$/)
      if (cover) {
        const hue = (Number(cover[1]) * 47) % 360
        res.statusCode = 200
        res.setHeader('Content-Type', 'image/svg+xml')
        return res.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400"><rect width="600" height="400" fill="hsl(${hue} 70% 55%)"/><circle cx="440" cy="150" r="90" fill="hsl(${(hue + 40) % 360} 85% 75%)"/><path d="M0 330 L170 210 L300 300 L420 230 L600 340 V400 H0Z" fill="hsl(${hue} 60% 35%)"/></svg>`)
      }
      const id = url.pathname.match(/^\/events\/(\d+)$/)?.[1]
      if (id) { const event = events.find(e => e.id === Number(id)); return event ? send(200, { data: event }) : fail(404, 'NOT_FOUND', 'Event not found.') }
      if (url.pathname === '/events/36/join-requests') return send(200, list(joinRequests))
      if (url.pathname === '/events/35/participants') return send(200, list([{ user: { id: 3, name: 'Riley Chen', email: 'riley@example.test', student_id: 'S3' }, status: 'joined', queue_position: null, checked_in: true }, { user: { id: 4, name: 'Zara Wong', email: 'zara@example.test', student_id: 'S4' }, status: 'joined', queue_position: null, checked_in: false }]))
      if (/^\/events\/\d+\/participants$/.test(url.pathname)) return send(200, list([]))
      if (url.pathname === '/clubs/1/members') return send(200, list([
        { user_id: user.id, name: user.name, role: 'committee', club_id: 1, version: 1, user: { id: user.id, name: user.name } },
        { user_id: 3, name: 'Riley Chen', role: 'member', club_id: 1, version: 2, user: { id: 3, name: 'Riley Chen' } },
        { user_id: 4, name: 'Zara Wong', role: 'committee', club_id: 1, version: 1, user: { id: 4, name: 'Zara Wong' } },
      ]))
      if (url.pathname === '/clubs/2/members') return send(200, list([{ user_id: 3, name: 'Morgan Lee', role: 'committee' }]))
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
      if (url.pathname === '/tags') return send(200, { data: campusTags })
      if (/^\/clubs\/\d+\/tags$/.test(url.pathname)) return send(200, { data: clubTags })
      if (url.pathname === '/me/signoffs') return send(200, { data: user.id && !empty ? { bookings: [awaitingBooking], events: [awaitingEvent] } : { bookings: [], events: [] } })
      if (/^\/events\/\d+\/attendance$/.test(url.pathname)) return send(200, { data: { joined_at_open: 12, attended: attendanceRecords.length, records: attendanceRecords }, meta: { page: 1, page_size: 20, total: attendanceRecords.length } })
      if (url.pathname === '/clubs/1/reports/effectiveness') return empty ? send(200, { data: { ...effectiveness, events: [], by_tag: [], by_weekday: [], by_slot: [] } }) : send(200, { data: effectiveness })
      if (url.pathname === '/notifications/stream') {
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/event-stream')
        res.write('retry: 3000\n\n')
        const timer = setTimeout(() => res.write(`id: 99\nevent: notification\ndata: ${JSON.stringify({ notification: { id: 99, type: 'event_published', title: 'New event: Rooftop sketching', body: 'Photography Society published an event.', event_id: 1, created_at: new Date().toISOString(), read_at: null }, unread_count: 4 })}\n\n`), 4000)
        req.on('close', () => clearTimeout(timer))
        return
      }
      const params = url.searchParams
      const filteredEvents = events.filter(event => event.state === 'published'
        && (!params.get('phase') || event.phase === params.get('phase'))
        && (!params.get('q') || [event.title, event.description, event.club.name, event.venue.name].some(value => value.toLowerCase().includes(params.get('q').trim().toLowerCase())))
        && (!params.get('club_id') || String(event.club.id) === params.get('club_id'))
        && (!params.get('venue_id') || String(event.venue.id) === params.get('venue_id'))
        && (!params.get('visibility') || event.visibility === params.get('visibility'))
        && (!params.get('from') || new Date(event.start_at) >= new Date(params.get('from')))
        && (!params.get('to') || new Date(event.start_at) < new Date(params.get('to')))
        && (!params.getAll('tag').length || event.campus_tags?.some(tag => params.getAll('tag').includes(tag.slug))))
      const page = Number(params.get('page')) || 1
      const pageSize = Number(params.get('page_size')) || 20
      const eventList = { data: filteredEvents.slice((page - 1) * pageSize, page * pageSize), meta: { page, page_size: pageSize, total: filteredEvents.length } }
      const pagedList = rows => ({ data: rows.slice((page - 1) * pageSize, page * pageSize), meta: { page, page_size: pageSize, total: rows.length } })
      const routes = { '/profile': { data: user }, '/clubs': pagedList(clubs), '/me/memberships': pagedList(empty ? [] : memberships), '/venues': pagedList(venues), '/events': eventList, '/me/events': list(empty ? [] : organizerEvents), '/me/registrations': pagedList(empty ? [] : myRegistrations), '/bookings': list(empty ? [] : bookingRequests), '/notifications': list(empty ? [] : inbox, { unread_count: empty ? 0 : inbox.filter(n => !n.read_at).length }) }
      return routes[url.pathname] ? send(200, routes[url.pathname]) : fail(404, 'NOT_FOUND', 'This endpoint is not included in the preview.')
    })
  } }
}
