import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { fixturePlugin } from '../dev/fixtures.js'

let handler
fixturePlugin().configureServer({ middlewares: { use(_path, callback) { handler = callback } } })

function call(path, { method = 'GET', authenticated = true, body = '' } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(body ? [body] : [])
    req.url = path
    req.method = method
    req.headers = { cookie: authenticated ? 'clubspace_preview=1' : '' }
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
  assert.equal((await call('/bookings')).body.meta.total, 2)
  assert.equal((await call('/bookings?preview=empty')).body.meta.total, 0)
  const zeroReport = await call(`/clubs/1/reports?preview=empty&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
  assert.ok(zeroReport.body.data.daily_actions.length > 0)
  assert.ok(zeroReport.body.data.daily_actions.every(day => day.joined === 0))
  assert.equal((await call(`/clubs/1/reports?preview=error&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).status, 503)
  const conflict = await call('/bookings/11/decision', { method: 'POST', body: '{}' })
  assert.equal(conflict.status, 409)
  assert.equal(conflict.body.error.code, 'VENUE_UNAVAILABLE')
  assert.equal((await call('/bookings', { authenticated: false })).status, 401)
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
