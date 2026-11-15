import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildIcs, icsFileName } from '../src/lib/ics.js'
import { registrationToast, registrationView } from '../src/lib/registration.js'

const base = {
  id: 1, title: 'Campus photo walk', state: 'published', capacity: 30, joined_count: 18, waitlisted_count: 0,
  registration_closes_at: '2026-11-19T05:00:00Z',
  my_registration: { status: 'none', queue_position: null },
  eligibility: { can_register: true, can_waitlist: false, reason: null },
}
const view = patch => registrationView({ ...base, ...patch })

test('a student who can register sees spots left and Join event', () => {
  assert.deepEqual(view({}), { kind: 'join', headline: '12 spots left', detail: 'Closes Thu 19 Nov, 13:00', label: 'Join event' })
})

test('a full event with room on the waitlist offers Join waitlist', () => {
  const result = view({ joined_count: 30, waitlisted_count: 4, eligibility: { can_register: false, can_waitlist: true, reason: 'EVENT_FULL' } })
  assert.equal(result.kind, 'waitlist')
  assert.equal(result.label, 'Join waitlist')
  assert.match(result.detail, /^4 waiting/)
})

test('joined offers Add to calendar and Leave event; waitlisted shows the position', () => {
  const joined = view({ my_registration: { status: 'joined' }, eligibility: { can_register: false, can_waitlist: false, reason: 'ALREADY_REGISTERED' } })
  assert.equal(joined.kind, 'leave')
  assert.equal(joined.calendar, true)
  assert.equal(joined.headline, 'You’re going!')
  for (const status of ['pending', 'waitlisted']) {
    const waiting = view({ my_registration: { status, queue_position: 3 }, eligibility: { reason: 'ALREADY_REGISTERED' } })
    assert.equal(waiting.kind, 'leave_waitlist')
    assert.equal(waiting.headline, 'You’re #3 on the waitlist')
    assert.equal(waiting.position, 3)
  }
})

test('restrictions say why there is no action', () => {
  assert.equal(view({ eligibility: { reason: 'MEMBERSHIP_REQUIRED' } }).label, 'Join club to register')
  assert.equal(view({ eligibility: { reason: 'MEMBERSHIP_REQUIRED' } }).kind, 'join_club')
  assert.deepEqual([view({ eligibility: { reason: 'REGISTRATION_CLOSED' } }).label, view({ eligibility: { reason: 'REGISTRATION_CLOSED' } }).disabled], ['Registration closed', true])
  assert.equal(view({ eligibility: { reason: 'WAITLIST_FULL' } }).label, 'Waitlist full')
  assert.equal(view({ eligibility: { reason: 'NOT_PUBLISHED' } }).disabled, true)
  assert.equal(view({ eligibility: undefined }).label, 'Unavailable')
})

test('a cancelled event wins over any registration state', () => {
  const cancelled = view({ state: 'cancelled', my_registration: { status: 'unsuccessful' }, eligibility: { reason: 'EVENT_CANCELLED' } })
  assert.equal(cancelled.kind, 'none')
  assert.equal(cancelled.chip, 'cancelled')
  assert.match(cancelled.detail, /cancelled with it/)
})

test('left and unsuccessful registrations count as not registered', () => {
  assert.equal(view({ my_registration: { status: 'left' } }).kind, 'join')
  assert.equal(view({ my_registration: { status: 'unsuccessful' } }).kind, 'join')
})

test('toasts confirm the result in words', () => {
  assert.equal(registrationToast({ status: 'joined' }), 'You’re going! Added to My events.')
  assert.equal(registrationToast({ status: 'waitlisted', queue_position: 3 }), 'You’re #3 on the waitlist.')
  assert.equal(registrationToast({ status: 'pending' }), 'You’re on the waitlist.')
})

test('the .ics file uses UTC instants, CRLF lines, escaping and folding', () => {
  const event = {
    id: 12, title: 'Photo, walk; with friends', description: 'Line one\nLine two '.padEnd(200, 'x'),
    club: { name: 'Photography Society' }, venue: { name: 'Harbour Room', location: 'Level 2' },
    start_at: '2026-11-20T05:00:00Z', end_at: '2026-11-20T07:00:00Z',
  }
  const ics = buildIcs(event, new Date('2026-11-16T00:00:00Z'))
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'))
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'))
  assert.ok(ics.includes('DTSTART:20261120T050000Z\r\n'))
  assert.ok(ics.includes('DTEND:20261120T070000Z\r\n'))
  assert.ok(ics.includes('DTSTAMP:20261116T000000Z\r\n'))
  assert.ok(ics.includes('UID:event-12@clubspace\r\n'))
  assert.ok(ics.includes('SUMMARY:Photo\\, walk\\; with friends\r\n'))
  assert.ok(ics.includes('LOCATION:Harbour Room\\, Level 2\r\n'))
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, `line too long: ${line}`)
  assert.ok(!/[^\r]\n/.test(ics), 'no bare LF')
})

test('the file name is a safe slug', () => {
  assert.equal(icsFileName({ title: 'Campus photo walk!' }), 'campus-photo-walk.ics')
  assert.equal(icsFileName({ title: '攝影學會' }), 'event.ics')
})
