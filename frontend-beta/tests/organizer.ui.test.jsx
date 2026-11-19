// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.jsx'
import { setCsrf } from '../src/api.js'
import { groupManaged, lifecycle } from '../src/lib/lifecycle.js'
import { fixtureFetch, json } from './support/fixtureFetch.js'

beforeEach(() => setCsrf(null))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/') })

const now = new Date('2026-11-16T00:00:00Z')
const base = { start_at: '2026-11-25T05:00:00Z', state: 'draft', booking: { status: 'pending' } }
const states = e => lifecycle({ ...base, ...e }, now).steps.map(s => `${s.id}:${s.state}`)

describe('lifecycle', () => {
  it('derives steps from booking status and event state', () => {
    expect(states({})).toEqual(['requested:done', 'approved:current', 'publish:upcoming', 'happening:upcoming'])
    expect(states({ booking: { status: 'confirmed' } })).toEqual(['requested:done', 'approved:done', 'publish:current', 'happening:upcoming'])
    expect(states({ state: 'published', booking: { status: 'confirmed' } })[2]).toBe('publish:done')
    const rejected = lifecycle({ ...base, booking: { status: 'rejected', decision_reason: 'Closed' } }, now)
    expect(rejected.steps[1]).toMatchObject({ state: 'failed', note: 'Closed', label: 'Rejected' })
    expect(rejected.next).toMatchObject({ kind: 'rerequest', label: 'Request another slot' })
    expect(lifecycle({ ...base, state: 'cancelled' }, now)).toBeNull()
    expect(lifecycle({ ...base, state: 'awaiting_president', booking: { status: 'awaiting_president' } }, now).steps[1].note).toBe('Waiting for the president')
  })

  it('names where a request is and never offers Publish while publication waits (F01, F03)', () => {
    const signoff = lifecycle({ ...base, booking: { status: 'awaiting_president' } }, now)
    expect(signoff.steps[1]).toMatchObject({ label: 'President sign-off', state: 'current' })
    expect(lifecycle({ ...base }, now).steps[1]).toMatchObject({ label: 'Venue review', note: 'Venue team reviewing' })
    const waiting = lifecycle({ ...base, state: 'awaiting_president', booking: { status: 'confirmed' } }, now)
    expect(waiting.next.kind).toBe('wait')
    expect(waiting.steps[2]).toMatchObject({ state: 'current', note: 'Waiting for the president' })
    const returned = lifecycle({ ...base, booking: { status: 'returned' }, signoff: { reason: 'Add a rain plan.' } }, now)
    expect(returned.steps[1]).toMatchObject({ label: 'Returned', note: 'Add a rain plan.' })
  })

  it('groups needs action, upcoming and past', () => {
    const g = groupManaged([
      { id: 1, ...base, booking: { status: 'confirmed' } },
      { id: 2, ...base, booking: { status: 'rejected' } },
      { id: 3, ...base },
      { id: 4, ...base, state: 'published', booking: { status: 'confirmed' } },
      { id: 5, ...base, start_at: '2026-11-01T05:00:00Z' },
      { id: 6, ...base, state: 'cancelled', booking: { status: 'cancelled' } },
      { id: 7, ...base, state: 'cancelled', start_at: '2026-11-01T05:00:00Z' },
    ], now)
    expect(g.needs.map(e => e.id)).toEqual([1, 2])
    expect(g.upcoming.map(e => e.id)).toEqual([3, 4])
    expect(g.past.map(e => e.id)).toEqual([5])
    // A future cancellation is neither upcoming nor past (UX-01).
    expect(g.cancelled.map(e => e.id)).toEqual([6, 7])
  })
})

describe('organizer pages', () => {
  it('home puts Needs action first with the approved and rejected drafts', async () => {
    window.history.replaceState({}, '', '/organizer')
    vi.stubGlobal('fetch', fixtureFetch())
    render(<App />)
    const needs = (await screen.findByRole('heading', { name: /Needs action/ })).closest('section')
    expect(await within(needs).findByText('Portrait workshop')).toBeTruthy()
    expect(within(needs).getByText('Night photography meetup')).toBeTruthy()
    expect(within(needs).getAllByText('Approved. Publish it so students can join.').length).toBeGreaterThan(0)
    expect(within(needs).queryByText('Pending darkroom session')).toBeNull()
    const headings = screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)
    expect(headings.findIndex(t => /Needs action/.test(t))).toBeLessThan(headings.findIndex(t => /Upcoming/.test(t)))
    expect(document.querySelectorAll('.cs-card.is-flat').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.cs-btn-primary').length).toBe(1)
  })

  it('manage page shows the stepper, publishes an approved draft, and confirms cancel in the page', async () => {
    window.history.replaceState({}, '', '/organizer/events/21')
    const fetch = fixtureFetch((url, options) => (options.method === 'POST' && /\/(publish|cancel)$/.test(url.pathname) ? json({ data: { id: 21 } }) : null))
    vi.stubGlobal('fetch', fetch)
    render(<App />)
    const steps = await screen.findByRole('list', { name: 'Event progress' })
    expect(within(steps).getByText('Publish').closest('li').getAttribute('aria-current')).toBe('step')
    // A committee member asks the president; the toast never claims it is live (F01).
    expect(screen.queryByRole('button', { name: 'Publish event' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Request publication' }))
    await waitFor(() => expect(fetch.mock.calls.some(([u, o]) => String(u).endsWith('/events/21/publish') && o.method === 'POST')).toBe(true))
    expect(JSON.parse(fetch.mock.calls.find(([u]) => String(u).endsWith('/publish'))[1].body)).toEqual({ expected_version: 1 })
    expect((await screen.findAllByText('Publication requested. Waiting for the president to publish it.')).length).toBeGreaterThan(0)
    expect(screen.queryByText('Event published. Students can join now.')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel event' }))
    expect(screen.getByRole('heading', { name: 'Cancel this event?' })).toBeTruthy()
    const confirm = screen.getAllByRole('button', { name: 'Cancel event' }).find(button => button.type === 'submit')
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: '   ' } })
    expect(confirm.disabled).toBe(true)
    expect(fetch.mock.calls.some(([u]) => String(u).endsWith('/cancel'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Keep event' }))
    expect(screen.queryByRole('heading', { name: 'Cancel this event?' })).toBeNull()
  })

  it('a rejected request shows the reason and offers another slot', async () => {
    window.history.replaceState({}, '', '/organizer/events/22')
    vi.stubGlobal('fetch', fixtureFetch())
    render(<App />)
    expect((await screen.findAllByText(/maintenance that day/)).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Request another slot' }).getAttribute('href')).toBe('/bookings/new')
  })

  it('tabs are kept in the URL', async () => {
    window.history.replaceState({}, '', '/organizer/events/21')
    vi.stubGlobal('fetch', fixtureFetch())
    render(<App />)
    fireEvent.click(await screen.findByRole('tab', { name: 'People' }))
    expect(window.location.search).toBe('?tab=people')
    expect(await screen.findByText('No participants in this state.')).toBeTruthy()
  })
})

describe('admin review', () => {
  it('lists pending requests with a count and blocks reviewing your own club', async () => {
    window.history.replaceState({}, '', '/admin/bookings')
    vi.stubGlobal('fetch', fixtureFetch())
    render(<App />)
    expect(await screen.findByRole('heading', { name: /Pending requests \(2\)/ })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Pending requests' }).tabIndex).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'Review Photography workshop' }))
    const dialog = await screen.findByRole('dialog', { name: 'Review request' })
    expect(within(dialog).getByText('You can’t review your own club’s request.')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Approve' }).disabled).toBe(true)
    expect(await within(dialog).findByText(/that day/)).toBeTruthy()
  })

  it('approves with the booking version and confirms that the event stays a draft', async () => {
    window.history.replaceState({}, '', '/admin/bookings')
    const fetch = fixtureFetch((url, options) => (/decision$/.test(url.pathname) && options.method === 'POST' ? json({ data: { id: 11 } }) : null))
    vi.stubGlobal('fetch', fetch)
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /^Review Student film showcase/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Review request' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(fetch.mock.calls.some(([u]) => String(u).endsWith('/bookings/11/decision'))).toBe(true))
    expect(JSON.parse(fetch.mock.calls.find(([u]) => String(u).endsWith('/decision'))[1].body)).toEqual({ expected_version: 1, decision: 'approve' })
    expect((await screen.findAllByText(/stays a draft/)).length).toBeGreaterThan(0)
  })

  it('shows an empty state when nothing is waiting', async () => {
    window.history.replaceState({}, '', '/admin/bookings')
    vi.stubGlobal('fetch', fixtureFetch(url => (url.pathname === '/api/v1/bookings' ? json({ data: [], meta: { page: 1, page_size: 20, total: 0 } }) : null)))
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'No requests waiting' })).toBeTruthy()
  })
})
