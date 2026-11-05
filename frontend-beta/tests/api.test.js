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
