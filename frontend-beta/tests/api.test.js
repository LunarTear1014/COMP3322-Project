import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { request, setCsrf, campusInstant, weekStart, addDays, overlaps } from '../src/api.js'
import { requestMainBackend } from '../src/mainBackend.js'
const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch; setCsrf(null) })
test('main backend adapter exposes every page of club and venue options', async () => {
  const rows = Array.from({length: 101}, (_, index) => ({id: index + 1, name: `Option ${index + 1}`}))
  globalThis.fetch = async () => new Response(JSON.stringify(rows), {status: 200})
  for (const path of ['/clubs', '/venues']) {
    const result = await requestMainBackend(`${path}?page=2&page_size=100`)
    assert.equal(result.meta.total, 101)
    assert.equal(result.data.length, 1)
    assert.equal(result.data[0].id, 101)
  }
})
test('main backend adapter normalizes legacy event registration statuses', async () => {
  const statuses = ['waitlisted', 'pending', 'left', 'cancelled', 'joined']
  globalThis.fetch = async () => new Response(JSON.stringify(statuses.map((status, index) => ({
    id: index + 1,
    title: `Event ${index + 1}`,
    date: '2099-01-01',
    timeslot: '10:00 - 12:00',
    event_status: index === 4 ? 'cancelled' : 'published',
    participation_status: status,
  }))), { status: 200 })

  const result = await requestMainBackend('/me/registrations')
  assert.deepEqual(result.data.map(registration => registration.status), [
    'pending', 'pending', 'unsuccessful', 'unsuccessful', 'unsuccessful',
  ])
})
test('main backend adapter sends committee leave requests to the backend', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ message: 'You are now a regular club member.' }), { status: 200 })
  }

  const result = await requestMainBackend('/clubs/4/committee', { method: 'DELETE' })
  assert.equal(calls[0].url, '/api/clubs/4/committee')
  assert.equal(calls[0].options.method, 'DELETE')
  assert.equal(result.data.message, 'You are now a regular club member.')
})
test('main backend adapter sends confirmed presidency transfers to the backend', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ message: 'Presidency transferred.' }), { status: 200 })
  }

  const body = { user_id: 3, confirmation: 'Film Society' }
  const result = await requestMainBackend('/clubs/4/presidency', { method: 'POST', body })
  assert.equal(calls[0].url, '/api/clubs/4/presidency')
  assert.equal(calls[0].options.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].options.body), body)
  assert.equal(result.data.message, 'Presidency transferred.')
})
test('main backend adapter loads club members and promotes a member', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    if (options.method === 'GET') {
      return new Response(JSON.stringify([{ user_id: 3, name: 'Riley Chen', role: 'member' }]), { status: 200 })
    }
    return new Response(JSON.stringify({ message: 'Member promoted to committee.' }), { status: 200 })
  }

  const members = await requestMainBackend('/clubs/5/members')
  assert.deepEqual(members.data, [{ user_id: 3, name: 'Riley Chen', role: 'member' }])

  const result = await requestMainBackend('/clubs/5/members/3/committee', { method: 'POST', body: {} })
  assert.equal(calls[1].url, '/api/clubs/5/members/3/committee')
  assert.equal(calls[1].options.method, 'POST')
  assert.equal(result.data.message, 'Member promoted to committee.')
})
test('main backend adapter sends member demotions and removals to the backend', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ message: 'Member updated.' }), { status: 200 })
  }

  await requestMainBackend('/clubs/5/members/3/committee', { method: 'DELETE' })
  await requestMainBackend('/clubs/5/members/3', { method: 'DELETE' })
  assert.equal(calls[0].url, '/api/clubs/5/members/3/committee')
  assert.equal(calls[0].options.method, 'DELETE')
  assert.equal(calls[1].url, '/api/clubs/5/members/3')
  assert.equal(calls[1].options.method, 'DELETE')
})
test('main backend adapter loads the club action log and requests an undo', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify([{ id: 21, actor_name: 'Morgan Lee', action_type: 'member_removed', created_epoch: Math.floor(Date.now() / 1000) }]), { status: 200 })
  }

  const actions = await requestMainBackend('/clubs/4/actions')
  assert.equal(actions.data[0].actor_name, 'Morgan Lee')
  const result = await requestMainBackend('/clubs/4/actions/21/undo', { method: 'POST', body: {} })
  assert.equal(calls[0].url, '/api/clubs/4/actions')
  assert.equal(calls[1].url, '/api/clubs/4/actions/21/undo')
  assert.equal(calls[1].options.method, 'POST')
  assert.equal(result.data[0].id, 21)
})
test('main backend adapter sends join request decisions to the backend', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ message: 'Join request approved.' }), { status: 200 })
  }

  const body = { decision: 'accept' }
  const result = await requestMainBackend('/clubs/4/join-requests/12/review', { method: 'POST', body })
  assert.equal(calls[0].url, '/api/clubs/4/join-requests/12/review')
  assert.equal(calls[0].options.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].options.body), body)
  assert.equal(result.data.message, 'Join request approved.')
})
test('main backend adapter identifies club join-request notifications', async () => {
  const timestamp = Math.floor(Date.now() / 1000)
  globalThis.fetch = async () => new Response(JSON.stringify([
    {
      id: 8,
      event_id: null,
      club_id: 4,
      club_join_request_id: 12,
      event_title: 'Join request: Photography Society',
      message: 'Sam Lee requested to join Photography Society.',
      created_epoch: timestamp,
      read_at: null,
    },
    {
      id: 9,
      event_id: null,
      club_id: 4,
      club_join_request_id: null,
      event_title: 'Join request accepted: Photography Society',
      message: 'Your request to join Photography Society was successful.',
      created_epoch: timestamp,
      read_at: null,
    },
    {
      id: 10,
      event_id: null,
      club_id: 4,
      club_join_request_id: null,
      event_title: 'Committee role: Photography Society',
      message: 'You have been made a committee member of Photography Society.',
      created_epoch: timestamp,
      read_at: null,
    },
    {
      id: 11,
      event_id: null,
      club_id: 4,
      club_join_request_id: null,
      event_title: 'President role: Photography Society',
      message: 'You have been made the president of Photography Society.',
      created_epoch: timestamp,
      read_at: null,
    },
  ]), { status: 200 })

  const result = await requestMainBackend('/notifications')
  assert.equal(result.data[0].type, 'club_join_request')
  assert.equal(result.data[0].join_request_id, 12)
  assert.equal(result.data[0].club_id, 4)
  assert.equal(result.data[1].type, 'club_membership')
  assert.equal(result.data[1].join_request_id, null)
  assert.equal(result.data[2].type, 'club_membership')
  assert.match(result.data[2].body, /made a committee member/)
  assert.equal(result.data[3].type, 'club_membership')
  assert.match(result.data[3].body, /made the president/)
})
test('Hong Kong week and half-open interval boundaries', () => {
  assert.equal(weekStart('2026-11-11'), '2026-11-09')
  assert.equal(campusInstant('2026-11-09'), '2026-11-08T16:00:00.000Z')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(overlaps('2026-11-08T15:00:00Z','2026-11-09T03:00:00Z','2026-11-09T02:00:00Z','2026-11-09T04:00:00Z'), true)
  assert.equal(overlaps('2026-11-09T00:00:00Z','2026-11-09T02:00:00Z','2026-11-09T02:00:00Z','2026-11-09T04:00:00Z'), false)
})
test('mutation obtains CSRF and sends cookie credentials and JSON', async () => {
  const calls=[]; globalThis.fetch=async (url,options)=>{ calls.push({url,options}); return new Response(JSON.stringify({data:url.endsWith('/csrf')?{csrf_token:'token'}:{id:1}}),{status:200,headers:{'content-type':'application/json'}}) }
  await request('/events', {method:'POST',body:{capacity:3}})
  assert.equal(calls.length,2); assert.equal(calls[1].url,'/api/v1/events'); assert.equal(calls[1].options.credentials,'same-origin'); assert.equal(calls[1].options.headers['X-CSRF-Token'],'token'); assert.deepEqual(JSON.parse(calls[1].options.body),{capacity:3})
})
test('structured conflict is exposed and never replayed', async () => {
  let calls=0; setCsrf('token'); globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({error:{code:'STALE_VERSION',message:'Refresh',fields:{}}}),{status:409})}
  await assert.rejects(request('/events/1',{method:'PATCH',body:{expected_version:1}}),e=>e.status===409 && e.code==='STALE_VERSION'); assert.equal(calls,1)
})

test('calendar rejects past and overlapping slots while allowing adjacent intervals', async () => {
  const { slotAvailability } = await import('../src/api.js')
  const now = new Date('2026-11-08T00:00:00Z')
  const booking = { busy: true, start_at: '2026-11-08T15:00:00Z', end_at: '2026-11-09T02:00:00Z' }
  assert.equal(slotAvailability('2026-11-07T02:00:00Z', '2026-11-07T04:00:00Z', [], now).status, 'past')
  assert.equal(slotAvailability('2026-11-09T01:00:00Z', '2026-11-09T03:00:00Z', [booking], now).status, 'busy')
  assert.equal(slotAvailability('2026-11-09T02:00:00Z', '2026-11-09T04:00:00Z', [booking], now).status, 'available')
})
