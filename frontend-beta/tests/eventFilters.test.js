import assert from 'node:assert/strict'
import { test } from 'node:test'
import { query } from '../src/apiShared.js'
import {
  activeFilterCount, clearedFilters, monthRange, rangeProblem, readFilters, toApiQuery, weekRange, writeFilters,
} from '../src/lib/eventFilters.js'
import { clubColour } from '../src/lib/club.js'
import { dateTile, seatSummary, timeLine } from '../src/lib/format.js'

const read = search => readFilters(new URLSearchParams(search))

test('filters round-trip through the URL and default views have a clean URL', () => {
  assert.equal(writeFilters(clearedFilters).toString(), '')
  const filters = read('q=walk&when=week&visibility=public&club_id=2&venue_id=1&tag=music&tag=free-food&page=3')
  assert.deepEqual(filters, { q: 'walk', phase: 'upcoming', club_id: '2', venue_id: '1', visibility: 'public', when: 'week', from: '', to: '', tag: ['music', 'free-food'], page: 3 })
  assert.deepEqual(read(writeFilters(filters).toString()), filters)
})

test('malformed URL values are dropped instead of sent to the API', () => {
  const filters = read('visibility=everyone&club_id=abc&venue_id=0&phase=never&from=2026-02-30&to=nope&tag=BAD%20TAG&page=-1&when=year')
  assert.deepEqual(filters, { ...clearedFilters })
  assert.equal(read(`q=${'x'.repeat(300)}`).q.length, 100)
  assert.equal(read('tag=a&tag=b&tag=c&tag=d&tag=e&tag=f').tag.length, 5)
})

test('This week is campus Monday to next Monday in UTC instants', () => {
  // Friday 20 Nov 2026, 13:00 Hong Kong time.
  const now = new Date('2026-11-20T05:00:00Z')
  assert.deepEqual(weekRange(now), { from: '2026-11-15T16:00:00.000Z', to: '2026-11-22T16:00:00.000Z' })
  // Sunday evening in Hong Kong still belongs to the week that is ending.
  assert.equal(weekRange(new Date('2026-11-22T10:00:00Z')).from, '2026-11-15T16:00:00.000Z')
  assert.deepEqual(monthRange(now), { from: '2026-10-31T16:00:00.000Z', to: '2026-11-30T16:00:00.000Z' })
})

test('API query maps presets, custom dates, visibility and repeated tags', () => {
  const now = new Date('2026-11-20T05:00:00Z')
  const preset = toApiQuery(read('when=week&visibility=public'), now)
  assert.equal(query(preset), '?phase=upcoming&visibility=public&from=2026-11-15T16%3A00%3A00.000Z&to=2026-11-22T16%3A00%3A00.000Z')
  const custom = toApiQuery(read('from=2026-12-01&to=2026-12-03&tag=music&tag=tech&club_id=2'), now)
  assert.equal(query(custom), '?phase=upcoming&club_id=2&tag=music&tag=tech&from=2026-11-30T16%3A00%3A00.000Z&to=2026-12-03T16%3A00%3A00.000Z')
  assert.equal(query(toApiQuery(read('page=2'), now)), '?phase=upcoming&page=2')
})

test('date ranges must be paired, ordered and within 93 days', () => {
  assert.equal(rangeProblem(read('')), '')
  assert.equal(rangeProblem(read('from=2026-12-01')), 'Choose both dates.')
  assert.match(rangeProblem(read('from=2026-12-05&to=2026-12-01')), /must not be before/)
  assert.match(rangeProblem(read('from=2026-01-01&to=2026-06-01')), /at most 93 days/)
  assert.equal(rangeProblem(read('from=2026-12-01&to=2026-12-01')), '')
})

test('active filters are counted for the sheet and the clear action', () => {
  assert.equal(activeFilterCount(read('')), 0)
  assert.equal(activeFilterCount(read('club_id=2&venue_id=1&when=week&q=hi')), 4)
})

test('club colours cycle by club_id modulo 8 and never fail', () => {
  assert.equal(clubColour(1).name, 'mint')
  assert.equal(clubColour(8).name, 'coral')
  assert.equal(clubColour(10).cssVar, 'var(--club-sun)')
  assert.equal(clubColour(undefined).name, 'coral')
})

test('dates and seats read as campus-time words', () => {
  const start = '2026-11-20T05:00:00Z'
  const end = '2026-11-20T07:00:00Z'
  assert.equal(timeLine(start, end), 'Fri 20 Nov · 13:00–15:00')
  assert.deepEqual(dateTile(start), { month: 'NOV', day: '20', iso: '2026-11-20T13:00+08:00' })
  // 23:30 UTC is already the next day in Hong Kong.
  assert.equal(dateTile('2026-11-19T23:30:00Z').day, '20')
  assert.deepEqual(seatSummary({ capacity: 30, joined_count: 18, waitlisted_count: 0 }), { left: 12, joined: '18 of 30 joined', caption: '12 spots left', ratio: 0.6 })
  assert.equal(seatSummary({ capacity: 30, joined_count: 30, waitlisted_count: 4 }).caption, '4 waiting')
  assert.equal(seatSummary({ capacity: 30, joined_count: 29, waitlisted_count: 0 }).caption, '1 spot left')
})
