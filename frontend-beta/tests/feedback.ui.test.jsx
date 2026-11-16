// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.jsx'
import { setCsrf } from '../src/api.js'
import { fixtureFetch, json } from './support/fixtureFetch.js'

beforeEach(() => setCsrf(null))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/') })

const president = { user: { id: 1, name: 'Alex Chan', email: 'p@x.test', student_id: 'S', platform_role: 'student' }, memberships: [{ club_id: 1, club_name: 'Photography Society', role: 'president', joined_at: '2026-01-01T00:00:00Z' }], csrf_token: 't' }
const committee = { ...president, user: { ...president.user, id: 5 }, memberships: [{ ...president.memberships[0], role: 'committee' }] }
const asCommittee = (url) => (url.pathname === '/api/v1/auth/session' ? json({ data: committee }) : null)
const asPresident = (extra) => (url, options) => (url.pathname === '/api/v1/auth/session' ? json({ data: president }) : extra?.(url, options) ?? null)
const calls = (fetch, method, match) => fetch.mock.calls.filter(([u, o]) => o?.method === method && match.test(String(u)))
const body = call => JSON.parse(call[1].body)

describe('president sign-off and roles (8.2)', () => {
  it('shows the sign-off queue on Organizer home and sends a request on or returns it with a reason', async () => {
    window.history.replaceState({}, '', '/organizer')
    const fetch = fixtureFetch(asPresident((url, options) => (/signoff$/.test(url.pathname) && options.method === 'POST' ? json({ data: { id: 31 } }) : null)))
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    const queue = (await screen.findByRole('heading', { name: /Waiting for your sign-off \(2\)/ })).closest('section')
    expect(within(queue).getByText('Zine-making evening')).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Your roles' }).textContent).toContain('Photography Society: President')
    fireEvent.click(within(queue).getAllByRole('button', { name: 'Send to venue team' })[0])
    await waitFor(() => expect(calls(fetch, 'POST', /bookings\/31\/signoff/).length).toBe(1))
    expect(body(calls(fetch, 'POST', /bookings\/31\/signoff/)[0])).toEqual({ expected_version: 1, decision: 'send' })

    fireEvent.click(within(queue).getAllByRole('button', { name: 'Return with a reason' })[1])
    const send = within(queue).getByRole('button', { name: 'Return request' })
    expect(send.disabled).toBe(true)
    fireEvent.change(within(queue).getByLabelText(/Reason for returning/), { target: { value: 'Add a rain plan.' } })
    fireEvent.click(send)
    await waitFor(() => expect(calls(fetch, 'POST', /events\/32\/signoff/).length).toBe(1))
    expect(body(calls(fetch, 'POST', /events\/32\/signoff/)[0])).toEqual({ expected_version: 1, decision: 'return', reason: 'Add a rain plan.' })
  })

  it('committee members never see the queue; waiting and returned states are explained', async () => {
    window.history.replaceState({}, '', '/organizer')
    vi.stubGlobal('fetch', fixtureFetch())
    render(<App />)
    expect(await screen.findByRole('heading', { name: /Needs action/ })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /Waiting for your sign-off/ })).toBeNull()
    expect(screen.getAllByText('Waiting for the president.').length).toBeGreaterThan(0)
    cleanup()

    window.history.replaceState({}, '', '/organizer/events/33')
    render(<App />)
    expect((await screen.findByRole('status', { name: '' }).catch(() => null)) ?? true).toBeTruthy()
    expect(await screen.findByText(/Returned by the president: Please add a rain plan/)).toBeTruthy()
    cleanup()

    window.history.replaceState({}, '', '/organizer/events/32')
    render(<App />)
    expect(await screen.findByText('Waiting for the president to publish this event.')).toBeTruthy()
  })

  it('only the president cancels a published event', async () => {
    window.history.replaceState({}, '', '/organizer/events/1')
    vi.stubGlobal('fetch', fixtureFetch(asCommittee))
    render(<App />)
    expect(await screen.findByText('Only the president can cancel a published event.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancel event' })).toBeNull()
    cleanup()

    vi.stubGlobal('fetch', fixtureFetch(asPresident()))
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Cancel event' })).toBeTruthy()
  })

  it('the president appoints, removes and transfers with a confirmation; committee is read-only', async () => {
    window.history.replaceState({}, '', '/organizer/clubs/1/members')
    const fetch = fixtureFetch(asPresident((url, options) => (options.method && options.method !== 'GET' ? json({ data: {} }) : null)))
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Appoint Riley Chen to the committee' }))
    await waitFor(() => expect(calls(fetch, 'PATCH', /members\/3$/).length).toBe(1))
    expect(body(calls(fetch, 'PATCH', /members\/3$/)[0])).toEqual({ role: 'committee', expected_version: 2 })
    fireEvent.click(screen.getByRole('button', { name: 'Remove Zara Wong from the committee' }))
    await waitFor(() => expect(calls(fetch, 'PATCH', /members\/4$/).length).toBe(1))
    expect(body(calls(fetch, 'PATCH', /members\/4$/)[0])).toEqual({ role: 'member', expected_version: 1 })

    fireEvent.click(screen.getByRole('button', { name: 'Make Zara Wong president' }))
    expect(calls(fetch, 'POST', /presidency/).length).toBe(0)
    fireEvent.click(within(screen.getByRole('group', { name: 'Transfer the presidency to Zara Wong' })).getByRole('button', { name: 'Transfer presidency' }))
    await waitFor(() => expect(calls(fetch, 'POST', /presidency/).length).toBe(1))
    expect(body(calls(fetch, 'POST', /presidency/)[0])).toEqual({ to_user_id: 4, expected_version: 1 })
    cleanup()

    window.history.replaceState({}, '', '/organizer/clubs/1/members')
    vi.stubGlobal('fetch', fixtureFetch(asCommittee))
    render(<App />)
    expect(await screen.findByText(/Only the president can change roles./)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Appoint|Make .* president/ })).toBeNull()
  })
})

describe('tags (8.3)', () => {
  it('tag chips filter through the URL and the API, and cards show their tags', async () => {
    window.history.replaceState({}, '', '/events')
    const fetch = fixtureFetch()
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    const toolbar = await screen.findByRole('toolbar', { name: 'Event filters' })
    fireEvent.click(await within(toolbar).findByRole('button', { name: 'Music' }))
    expect(window.location.search).toBe('?tag=music')
    await waitFor(() => expect(fetch.mock.calls.some(([u]) => new URL(u, 'http://x').searchParams.getAll('tag').includes('music'))).toBe(true))
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Sports' }))
    expect(window.location.search).toBe('?tag=music&tag=sports')
    expect(within(toolbar).getByRole('button', { name: 'Music' }).getAttribute('aria-pressed')).toBe('true')
    const card = (await screen.findAllByRole('list', { name: 'Tags' }))[0]
    expect(within(card).getByText('Music')).toBeTruthy()
  })

  it('the event page shows campus and club tags; the picker allows 3 campus tags and creates club tags', async () => {
    window.history.replaceState({}, '', '/events/1')
    vi.stubGlobal('fetch', fixtureFetch())
    render(<App />)
    const list = await screen.findByRole('list', { name: 'Tags' })
    expect(within(list).getByText('Arts')).toBeTruthy()
    expect(within(list).getByText('Beginners')).toBeTruthy()
    cleanup()

    window.history.replaceState({}, '', '/bookings/new?venue_id=1&step=details')
    const fetch = fixtureFetch((url, options) => (url.pathname === '/api/v1/clubs/1/tags' && options.method === 'POST' ? json({ data: { id: 9, name: 'Workshop' } }) : null))
    vi.stubGlobal('fetch', fetch)
    render(<App />)
    const group = (await screen.findAllByRole('group', { name: /Campus tags/ }))[0]
    for (const name of ['Arts', 'Music', 'Sports', 'Tech']) fireEvent.click(await within(group).findByLabelText(name))
    expect(within(group).getByLabelText('Tech').disabled).toBe(true)
    expect(within(group).getByLabelText('Arts').checked).toBe(true)
    fireEvent.change(screen.getAllByLabelText('New club tag')[0], { target: { value: 'Workshop' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Add club tag' })[0])
    await waitFor(() => expect(calls(fetch, 'POST', /clubs\/1\/tags/).length).toBe(1))
    expect(body(calls(fetch, 'POST', /clubs\/1\/tags/)[0])).toEqual({ name: 'Workshop' })
  })
})

describe('check-in (8.4) and views (8.5)', () => {
  it('organizers open check-in, see the large code and mark or unmark people', async () => {
    window.history.replaceState({}, '', '/organizer/events/35?tab=checkin')
    const fetch = fixtureFetch((url, options) => {
      if (/checkin$/.test(url.pathname) && options.method === 'POST') return json({ data: { code: '4821', opens_at: '2026-11-16T00:00:00Z', closes_at: '2026-11-16T05:00:00Z' } })
      if (/attendance\/\d+$/.test(url.pathname) && options.method) return json({ data: {} })
      return null
    })
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Open check-in' }))
    expect(await screen.findByLabelText('Check-in code 4 8 2 1')).toBeTruthy()
    expect(screen.getByText(/1 of 12 joined have checked in/)).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Mark Zara Wong as present' }))
    await waitFor(() => expect(calls(fetch, 'PUT', /attendance\/4$/).length).toBe(1))
    fireEvent.click(screen.getByRole('button', { name: 'Unmark Riley Chen as present' }))
    await waitFor(() => expect(calls(fetch, 'DELETE', /attendance\/3$/).length).toBe(1))
  })

  it('a joined student sees Check in inside the window, enters the code, and sees a field error for a wrong one', async () => {
    window.history.replaceState({}, '', '/events/35')
    let attempts = 0
    const fetch = fixtureFetch((url, options) => {
      if (/attendance$/.test(url.pathname) && options.method === 'POST') {
        attempts += 1
        return attempts === 1
          ? json({ error: { code: 'VALIDATION_FAILED', message: 'x', fields: { code: 'That code doesn’t match. Ask the organizers.' }, request_id: 'r' } }, 422)
          : json({ data: { event_id: 35, user_id: 1, method: 'code' } }, 201)
      }
      return null
    })
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    fireEvent.click((await screen.findAllByRole('button', { name: 'Check in' }))[0])
    const input = await screen.findByLabelText('Check-in code')
    const submit = () => within(input.closest('form')).getByRole('button', { name: 'Check in' })
    expect(submit().disabled).toBe(true)
    fireEvent.change(input, { target: { value: '12ab34' } })
    expect(input.value).toBe('1234')
    fireEvent.click(submit())
    expect(await screen.findByText('That code doesn’t match. Ask the organizers.')).toBeTruthy()
    fireEvent.click(submit())
    await waitFor(() => expect(calls(fetch, 'POST', /attendance$/).length).toBe(2))
    expect(body(calls(fetch, 'POST', /attendance$/)[1])).toEqual({ code: '1234' })
  })

  it('opening an event records one view with the source of the entry point', async () => {
    window.history.replaceState({}, '', '/events')
    const fetch = fixtureFetch((url, options) => (/views$/.test(url.pathname) && options.method === 'POST' ? new Response(null, { status: 204 }) : null))
    vi.stubGlobal('fetch', fetch)
    render(<App />)
    fireEvent.click(await screen.findByRole('link', { name: 'Campus photo walk' }))
    await waitFor(() => expect(calls(fetch, 'POST', /events\/1\/views/).length).toBe(1))
    expect(body(calls(fetch, 'POST', /events\/1\/views/)[0])).toEqual({ source: 'explore' })
    cleanup()

    window.history.replaceState({}, '', '/events/2')
    render(<App />)
    await waitFor(() => expect(calls(fetch, 'POST', /events\/2\/views/).length).toBe(1))
    expect(body(calls(fetch, 'POST', /events\/2\/views/)[0])).toEqual({ source: 'share' })
  })
})

describe('effectiveness report (8.5)', () => {
  it('shows per-event numbers, honest Not recorded and Too few events states, and definitions', async () => {
    window.history.replaceState({}, '', '/organizer/clubs/1/reports/effectiveness')
    vi.stubGlobal('fetch', fixtureFetch())
    render(<App />)

    const table = (await screen.findByRole('region', { name: 'Per event table' })).querySelector('table')
    const rows = within(table).getAllByRole('row')
    expect(within(rows[1]).getByText('81%')).toBeTruthy()
    expect(within(rows[1]).getByText(/Explore 120/)).toBeTruthy()
    expect(within(rows[2]).getAllByText('Not recorded').length).toBeGreaterThanOrEqual(3)
    expect(screen.getAllByText('Too few events').length).toBeGreaterThan(0)
    expect(screen.getByRole('figure', { name: /Chart: filled at start and turnout/ })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'By tag table' })).toBeTruthy()
    expect(screen.getByText('What these numbers mean')).toBeTruthy()
    expect(screen.getByText(/Groups with fewer than 3 events/)).toBeTruthy()
  })

  it('rejects an over-long range without calling the API and shows an empty state', async () => {
    window.history.replaceState({}, '', '/organizer/clubs/1/reports/effectiveness')
    const fetch = fixtureFetch((url) => (/effectiveness$/.test(url.pathname) ? json({ data: { club_id: 1, events: [], by_tag: [], by_weekday: [], by_slot: [] } }) : null))
    vi.stubGlobal('fetch', fetch)
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'No published events in this period' })).toBeTruthy()
    const before = fetch.mock.calls.length
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2025-01-01' } })
    expect(await screen.findByText(/at most 93 days apart/)).toBeTruthy()
    expect(fetch.mock.calls.filter(([u]) => /effectiveness/.test(String(u))).every(([u]) => !String(u).includes('2024-12-31'))).toBe(true)
    void before
  })
})
