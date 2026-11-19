import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { fixturePlugin } from '../dev/fixtures.js'

let handler
fixturePlugin().configureServer({ middlewares: { use(_path, callback) { handler = callback } } })

function call(path, { method = 'GET', authenticated = true, body = '', as = 'student' } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(body ? [body] : [])
    req.url = path
    req.method = method
    req.headers = { cookie: authenticated ? (as === 'admin' ? 'clubspace_preview=admin' : 'clubspace_preview=1') : '' }
    const res = {
      statusCode: 200,
      setHeader() {},
      end(payload) { resolve({ status: this.statusCode, body: payload ? JSON.parse(payload) : null }) },
    }
    handler(req, res)
  })
}

test('preview exposes distinct participation states', async () => {
  const waiting = await call('/events/7')
  assert.equal(waiting.body.data.my_registration.queue_position, 2)
  assert.equal(waiting.body.data.my_registration.status, 'pending')
  const closed = await call('/events/4')
  assert.equal(closed.body.data.eligibility.reason, 'REGISTRATION_CLOSED')
  const cancelled = await call('/events/5')
  assert.equal(cancelled.body.data.state, 'cancelled')
  assert.equal(cancelled.body.data.my_registration.status, 'unsuccessful')
})

test('event discovery combines filters before pagination', async () => {
  const filtered = await call('/events?club_id=2&visibility=members_only&venue_id=1')
  assert.deepEqual(filtered.body.data.map(event => event.id), [6])
  const all = await call('/events?page_size=2&page=2')
  assert.equal(all.body.data.length, 2)
  assert.equal(all.body.meta.page, 2)
  assert.ok(all.body.meta.total > 2)
  const instant = filtered.body.data[0].start_at
  const from = encodeURIComponent(instant)
  const to = encodeURIComponent(new Date(new Date(instant).getTime() + 1).toISOString())
  assert.equal((await call(`/events?club_id=2&visibility=members_only&from=${from}&to=${to}`)).body.meta.total, 1)
  assert.equal((await call(`/events?club_id=2&visibility=members_only&from=2000-01-01T00%3A00%3A00Z&to=${from}`)).body.meta.total, 0)
})

test('club and venue options honor pagination', async () => {
  for (const path of ['/clubs', '/venues']) {
    const first = (await call(`${path}?page=1&page_size=1`)).body
    const second = (await call(`${path}?page=2&page_size=1`)).body
    assert.equal(first.data.length, 1)
    assert.equal(second.data.length, 1)
    assert.notEqual(first.data[0].id, second.data[0].id)
    assert.equal(second.meta.page, 2)
    assert.equal(second.meta.total, first.meta.total)
  }
})

test('preview report and booking review expose populated and restricted states', async () => {
  const now = new Date()
  const from = new Date(now.getTime() - 86400000).toISOString()
  const to = new Date(now.getTime() + 86400000).toISOString()
  const populated = await call(`/clubs/1/reports?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
  assert.equal(populated.body.data.daily_actions.reduce((sum, day) => sum + day.joined, 0), 4)
  assert.equal(populated.body.data.venue_hours[0].hours, 2)
  assert.equal((await call('/clubs/2/reports?from=x&to=y')).status, 403)
  const student = await call('/auth/session?preview=student')
  assert.equal(student.body.data.user.platform_role, 'student')
  assert.deepEqual(student.body.data.memberships, [])
  assert.equal((await call('/bookings', { as: 'admin' })).body.meta.total, 2)
  assert.equal((await call('/bookings?preview=empty', { as: 'admin' })).body.meta.total, 0)
  const zeroReport = await call(`/clubs/1/reports?preview=empty&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
  assert.ok(zeroReport.body.data.daily_actions.length > 0)
  assert.ok(zeroReport.body.data.daily_actions.every(day => day.joined === 0))
  assert.equal((await call(`/clubs/1/reports?preview=error&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).status, 503)
  const conflict = await call('/bookings/11/decision', { method: 'POST', body: '{}', as: 'admin' })
  assert.equal(conflict.status, 409)
  assert.equal(conflict.body.error.code, 'VENUE_UNAVAILABLE')
  assert.equal((await call('/bookings', { authenticated: false })).status, 401)
})

test('preview supplies covers, organizer groups and an unread inbox', async () => {
  const withCover = await call('/events/1')
  assert.match(withCover.body.data.cover.card_url, /^\/api\/v1\/events\/1\/cover\/card/)
  assert.ok(withCover.body.data.cover.alt.length > 10)
  assert.equal((await call('/events/12')).body.data.cover, null)
  const mine = (await call('/me/events')).body.data
  assert.ok(mine.some(event => event.state === 'draft' && event.booking.status === 'confirmed'), 'approved draft needs publishing')
  assert.ok(mine.some(event => event.booking.status === 'rejected' && event.booking.decision_reason))
  assert.ok(mine.some(event => event.phase === 'past'))
  assert.equal((await call('/events/21')).status, 200)
  const inbox = (await call('/notifications')).body
  assert.equal(inbox.meta.unread_count, 3)
  assert.equal((await call('/notifications?preview=empty')).body.meta.unread_count, 0)
  assert.ok((await call('/clubs')).body.data.length >= 5, 'enough clubs to cycle through the club colours')
})

test('preview config is public and calendar results respect venue and interval', async () => {
  assert.equal((await call('/config', { authenticated: false })).status, 200)
  const now = Date.now()
  const range = (start, end) => `from=${encodeURIComponent(new Date(now + start * 86400000).toISOString())}&to=${encodeURIComponent(new Date(now + end * 86400000).toISOString())}`
  const occupied = await call(`/venues/1/calendar?${range(0, 2)}`)
  assert.equal(occupied.body.data.bookings.length, 1)
  assert.equal(occupied.body.data.bookings[0].title, null)
  assert.equal((await call(`/venues/2/calendar?${range(0, 2)}`)).body.data.bookings.length, 0)
  assert.equal((await call(`/venues/1/calendar?${range(3, 4)}`)).body.data.bookings.length, 0)
})

test('the default preview account is a student who is on the Photography Society committee', async () => {
  const session = (await call('/auth/session')).body.data
  assert.equal(session.user.platform_role, 'student')
  assert.deepEqual(session.memberships.map(item => [item.club_id, item.role]), [[1, 'committee']])
  assert.equal((await call('/profile')).body.data.email, 'preview@clubspace.test')
})

test('the venue administrator account holds no club role and signs in with its own cookie', async () => {
  const session = (await call('/auth/session', { as: 'admin' })).body.data
  assert.equal(session.user.platform_role, 'venue_admin')
  assert.equal(session.user.email, 'admin@clubspace.test')
  assert.deepEqual(session.memberships, [])
  assert.equal((await call('/auth/session?preview=admin')).body.data.user.platform_role, 'venue_admin')
  assert.deepEqual((await call('/me/memberships', { as: 'admin' })).body.data, [])
  assert.ok((await call('/clubs', { as: 'admin' })).body.data.every(club => club.my_role === null))
  assert.deepEqual((await call('/me/registrations', { as: 'admin' })).body.data, [])
  assert.equal((await call('/profile', { as: 'admin' })).body.data.platform_role, 'venue_admin')
  assert.equal((await call('/auth/session?preview=admin', { authenticated: false })).status, 401)
})

test('login answers for the account whose credentials were used', async () => {
  let cookie = null
  const login = (email, password = 'preview12345') => new Promise(resolve => {
    const req = Readable.from([JSON.stringify({ email, password })])
    req.url = '/auth/login'
    req.method = 'POST'
    req.headers = {}
    handler(req, { statusCode: 200, setHeader(name, value) { if (name === 'Set-Cookie') cookie = value }, end(payload) { resolve({ status: this.statusCode, body: JSON.parse(payload) }) } })
  })
  const admin = await login('admin@clubspace.test')
  assert.equal(admin.body.data.user.platform_role, 'venue_admin')
  assert.match(cookie, /^clubspace_preview=admin;/)
  const student = await login('preview@clubspace.test')
  assert.equal(student.body.data.user.platform_role, 'student')
  assert.match(cookie, /^clubspace_preview=1;/)
  assert.equal((await login('admin@clubspace.test', 'wrong-password')).status, 401)
})

test('venue administration needs the administrator account', async () => {
  for (const path of ['/bookings', '/admin/schedule?from=2026-11-16T00:00:00Z&to=2026-11-23T00:00:00Z']) {
    assert.equal((await call(path)).status, 403, path)
    assert.equal((await call(path, { as: 'admin' })).status, 200, path)
  }
  assert.equal((await call('/bookings/11/decision', { method: 'POST', body: '{}' })).status, 403)
})

test('events carry VENUE_ADMIN eligibility for the administrator and stay registrable for the student', async () => {
  const forAdmin = (await call('/events/1', { as: 'admin' })).body.data
  assert.equal(forAdmin.eligibility.reason, 'VENUE_ADMIN')
  assert.equal(forAdmin.eligibility.can_register, false)
  assert.equal(forAdmin.my_registration.status, 'none')
  assert.equal((await call('/events/10', { as: 'admin' })).body.data.my_registration.status, 'none')
  assert.equal((await call('/events/5?preview=admin')).body.data.eligibility.reason, 'EVENT_CANCELLED')
  assert.ok((await call('/events?preview=admin')).body.data.every(event => event.eligibility.reason !== null))
  assert.equal((await call('/events/1')).body.data.eligibility.can_register, true)
})

test('organizer people views are refused for the venue admin like the real API', async () => {
  assert.equal((await call('/events/1/participants', { as: 'admin' })).status, 403)
  assert.equal((await call('/events/1/participation-history', { as: 'admin' })).status, 403)
  assert.equal((await call('/events/9999/participation-history', { as: 'admin' })).status, 404)
  const history = (await call('/events/1/participation-history?action=quit')).body
  assert.ok(history.data.length > 0 && history.data.every(entry => entry.action === 'left'))
  assert.equal(history.summary.rejoined_people, 1)
})
