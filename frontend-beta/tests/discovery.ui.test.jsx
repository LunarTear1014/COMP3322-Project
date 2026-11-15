// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from '../src/App.jsx'
import { setCsrf } from '../src/api.js'
import { fixtureFetch, json } from './support/fixtureFetch.js'

beforeEach(() => setCsrf(null))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
})

const eventCalls = fetch => fetch.mock.calls.map(([input]) => new URL(input, 'http://localhost')).filter(url => url.pathname === '/api/v1/events')

describe('event discovery', () => {
  it('turns quick chips into API parameters and URL parameters, and restores them on reload', async () => {
    window.history.replaceState({}, '', '/events')
    const fetch = fixtureFetch()
    vi.stubGlobal('fetch', fetch)
    const { unmount } = render(<App />)

    const toolbar = await screen.findByRole('toolbar', { name: 'Event filters' })
    fireEvent.click(within(toolbar).getByRole('button', { name: 'This week' }))
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Open to everyone' }))

    expect(window.location.search).toBe('?visibility=public&when=week')
    await waitFor(() => {
      const last = eventCalls(fetch).at(-1)
      expect(last.searchParams.get('visibility')).toBe('public')
      expect(last.searchParams.get('from')).toMatch(/T16:00:00\.000Z$/)
      expect(last.searchParams.get('to')).toMatch(/T16:00:00\.000Z$/)
    })
    expect(within(toolbar).getByRole('button', { name: 'This week' }).getAttribute('aria-pressed')).toBe('true')

    unmount()
    render(<App />)
    const again = await screen.findByRole('toolbar', { name: 'Event filters' })
    expect(within(again).getByRole('button', { name: 'Open to everyone' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(again).getByRole('button', { name: 'This week' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('opens the filter sheet, applies club and venue, and counts active sheet filters', async () => {
    window.history.replaceState({}, '', '/events')
    const fetch = fixtureFetch()
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /^Filters/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Filters' })
    await within(dialog).findByRole('option', { name: 'Film Society' })
    fireEvent.change(within(dialog).getByLabelText('Club'), { target: { value: '2' } })
    fireEvent.change(within(dialog).getByLabelText('Venue'), { target: { value: '2' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show events' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(window.location.search).toBe('?club_id=2&venue_id=2')
    await waitFor(() => expect(eventCalls(fetch).at(-1).searchParams.get('club_id')).toBe('2'))
    const opener = screen.getByRole('button', { name: /^Filters/ })
    expect(within(opener).getByLabelText('2 active')).toBeTruthy()
  })

  it('shows a filtered-empty state with Clear filters, distinct from loading and errors', async () => {
    window.history.replaceState({}, '', '/events?club_id=5&visibility=members_only')
    vi.stubGlobal('fetch', fixtureFetch())
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Nothing matches these filters' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(window.location.search).toBe('')
    expect(await screen.findByRole('link', { name: 'Campus photo walk' })).toBeTruthy()
  })

  it('keeps an API failure separate from the empty state', async () => {
    window.history.replaceState({}, '', '/events')
    vi.stubGlobal('fetch', fixtureFetch(url => (url.pathname === '/api/v1/events'
      ? json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Events are unavailable.', fields: {} } }, 503)
      : null)))
    render(<App />)

    expect(await screen.findByText(/Events are unavailable/)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /Nothing matches|No events yet/ })).toBeNull()
  })

  it('rejects a reversed date range without calling the API', async () => {
    window.history.replaceState({}, '', '/events?from=2026-12-05&to=2026-12-01')
    const fetch = fixtureFetch()
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    expect((await screen.findByRole('alert')).textContent).toMatch(/end date must not be before/)
    expect(eventCalls(fetch).length).toBe(0)
  })

  it('renders cards as one link with date tile, club, meter, covers and chips', async () => {
    window.history.replaceState({}, '', '/events')
    vi.stubGlobal('fetch', fixtureFetch())
    render(<App />)

    const walk = (await screen.findByRole('link', { name: 'Campus photo walk' })).closest('article')
    expect(within(walk).getAllByRole('link').length).toBe(1)
    expect(walk.querySelector('time.cs-datetile').getAttribute('datetime')).toMatch(/\+08:00$/)
    expect(within(walk).getByText('18 of 30 joined')).toBeTruthy()
    expect(within(walk).getByText('12 spots left')).toBeTruthy()
    const image = walk.querySelector('img')
    expect(image.getAttribute('width')).toBe('600')
    expect(image.getAttribute('height')).toBe('400')
    expect(image.getAttribute('alt')).toBe('')
    expect(walk.style.getPropertyValue('--club')).toBe('var(--club-mint)')

    const nocover = screen.getByRole('link', { name: 'Film night: stories in motion' }).closest('article')
    expect(nocover.querySelector('img')).toBeNull()
    expect(nocover.querySelector('.cs-cover-art').getAttribute('aria-hidden')).toBe('true')

    const almost = screen.getByRole('link', { name: 'Almost full board-game night' }).closest('article')
    expect(within(almost).getAllByText('Almost full').length).toBeGreaterThan(0)
    expect(almost.querySelector('.is-hot')).toBeTruthy()
    const members = screen.getByRole('link', { name: 'Members-only gathering' }).closest('article')
    expect(within(members).getByText('Members only')).toBeTruthy()
    const joined = screen.getByRole('link', { name: 'Joined event' }).closest('article')
    expect(within(joined).getByText('Joined')).toBeTruthy()
  })
})
