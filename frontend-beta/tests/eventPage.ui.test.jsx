// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.jsx'
import { setCsrf } from '../src/api.js'
import { fixtureFetch, json } from './support/fixtureFetch.js'

beforeEach(() => setCsrf(null))
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete window.matchMedia
  window.history.replaceState({}, '', '/')
})

const phone = () => { window.matchMedia = query => ({ matches: query.includes('max-width: 767.98px'), addEventListener() {}, removeEventListener() {} }) }
const writes = fetch => fetch.mock.calls.filter(([url, options]) => /registration$/.test(String(url)) && options?.method && options.method !== 'GET')

// Overrides POST/DELETE registration (the preview is read-only).
function registrationFetch(result) {
  return fixtureFetch((url, options) => (/\/events\/\d+\/registration$/.test(url.pathname) && options.method
    ? json({ data: { event_id: 1, joined_count: 19, waitlisted_count: 0, ...result } }, options.method === 'POST' ? 201 : 200)
    : null))
}

describe('event page on desktop', () => {
  it('shows the cover, one-line time, state card and a Join event action', async () => {
    window.history.replaceState({}, '', '/events/1')
    vi.stubGlobal('fetch', registrationFetch({ status: 'joined' }))
    render(<App />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Campus photo walk' })).toBeTruthy()
    expect(screen.getByText(/Mon 23 Nov · \d\d:\d\d–\d\d:\d\d|\w{3} \d+ \w{3} · \d\d:\d\d–\d\d:\d\d/)).toBeTruthy()
    expect(screen.getByText('Hong Kong time')).toBeTruthy()
    const image = document.querySelector('.event-cover img')
    expect(image.getAttribute('alt')).toMatch(/golden hour/)
    expect([image.getAttribute('width'), image.getAttribute('height')]).toEqual(['1200', '800'])
    const side = screen.getByRole('complementary', { name: 'Registration' })
    expect(within(side).getByText('12 spots left')).toBeTruthy()
    expect(document.querySelector('.sticky-action-bar')).toBeNull()

    fireEvent.click(within(side).getByRole('button', { name: 'Join event' }))
    await waitFor(() => expect(screen.getAllByText('You’re going! Added to My events.').length).toBeGreaterThan(0))
    expect(JSON.parse(writes(fetch)[0][1].body)).toEqual({ allow_waitlist: false })
    expect(within(side).getByRole('button', { name: 'You’re going!' }).className).toContain('cs-btn-success')
  })

  it('offers Join waitlist when full and announces the queue position', async () => {
    window.history.replaceState({}, '', '/events/3')
    const fetch = registrationFetch({ status: 'waitlisted', queue_position: 5 })
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Join waitlist' }))
    expect((await screen.findAllByText('You’re #5 on the waitlist.')).length).toBeGreaterThan(0)
    expect(JSON.parse(writes(fetch)[0][1].body)).toEqual({ allow_waitlist: true })
  })

  it('explains restrictions instead of showing a dead button', async () => {
    window.history.replaceState({}, '', '/events/6')
    vi.stubGlobal('fetch', fixtureFetch())
    render(<App />)
    const link = await screen.findByRole('link', { name: 'Join club to register' })
    expect(link.getAttribute('href')).toBe('/clubs')
    expect(screen.getAllByText('Members only').length).toBeGreaterThan(0)
    cleanup()

    window.history.replaceState({}, '', '/events/4')
    render(<App />)
    const closed = await screen.findByRole('button', { name: 'Registration closed' })
    expect(closed.disabled).toBe(true)
    cleanup()

    window.history.replaceState({}, '', '/events/5')
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Event cancelled' })).toBeTruthy()
    expect(screen.getAllByText('Cancelled').length).toBeGreaterThan(0)
  })

  it('shows a 409 next to the action and refetches the event', async () => {
    window.history.replaceState({}, '', '/events/1')
    const fetch = fixtureFetch((url, options) => (/registration$/.test(url.pathname) && options.method === 'POST'
      ? json({ error: { code: 'EVENT_FULL', message: 'That event just filled up.', fields: {}, request_id: 'r' } }, 409)
      : null))
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    const before = fetch.mock.calls.filter(([url]) => String(url).endsWith('/events/1')).length
    fireEvent.click(await screen.findByRole('button', { name: 'Join event' }))
    expect(await screen.findByText(/That event just filled up/)).toBeTruthy()
    await waitFor(() => expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/events/1')).length).toBeGreaterThan(before))
  })

  it('downloads an .ics for a joined event', async () => {
    window.history.replaceState({}, '', '/events/10')
    vi.stubGlobal('fetch', fixtureFetch())
    const created = []
    URL.createObjectURL = blob => { created.push(blob); return 'blob:test' }
    URL.revokeObjectURL = () => {}
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function record() { created.push(this.download) })
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Add to calendar/ }))
    expect(created[0].type).toBe('text/calendar;charset=utf-8')
    expect(created[1]).toBe('joined-event.ics')
    click.mockRestore()
  })
})

describe('leaving with Undo', () => {
  async function openJoinedEvent() {
    window.history.replaceState({}, '', '/events/10')
    const fetch = registrationFetch({ status: 'left' })
    vi.stubGlobal('fetch', fetch)
    render(<App />)
    const side = await screen.findByRole('complementary', { name: 'Registration' })
    expect(within(side).getByText('You’re going!')).toBeTruthy()
    return { fetch, side }
  }

  it('sends nothing while the Undo window is open and nothing at all after Undo', async () => {
    const { fetch, side } = await openJoinedEvent()
    vi.useFakeTimers()
    fireEvent.click(within(side).getByRole('button', { name: 'Leave event' }))
    expect(screen.getAllByText('You left the event.').length).toBeGreaterThan(0)
    expect(within(side).getByRole('button', { name: 'Leaving…' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    act(() => { vi.advanceTimersByTime(6000) })
    expect(writes(fetch).length).toBe(0)
    expect(within(side).getByRole('button', { name: 'Leave event' })).toBeTruthy()
  })

  it('sends the DELETE once the window closes', async () => {
    const { fetch, side } = await openJoinedEvent()
    vi.useFakeTimers()
    fireEvent.click(within(side).getByRole('button', { name: 'Leave event' }))
    expect(writes(fetch).length).toBe(0)
    act(() => { vi.advanceTimersByTime(5100) })
    vi.useRealTimers()
    await waitFor(() => expect(writes(fetch).length).toBe(1))
    expect(writes(fetch)[0][1].method).toBe('DELETE')
  })
})

describe('event page on a phone', () => {
  it('keeps the action in a sticky bar with a live info line and reserves its height', async () => {
    phone()
    window.history.replaceState({}, '', '/events/1')
    vi.stubGlobal('fetch', registrationFetch({ status: 'joined' }))
    render(<App />)

    const bar = await waitFor(() => {
      const element = document.querySelector('.sticky-action-bar')
      expect(element).toBeTruthy()
      return element
    })
    const info = bar.querySelector('.cs-actionbar-info')
    expect(info.getAttribute('aria-live')).toBe('polite')
    expect(within(info).getByText('12 spots left')).toBeTruthy()
    expect(info.textContent).toMatch(/Closes/)
    expect(document.documentElement.style.getPropertyValue('--actionbar-height')).toBe('76px')
    expect(screen.queryByRole('button', { name: 'Join event', hidden: false, description: undefined })).toBeTruthy()

    fireEvent.click(within(bar).getByRole('button', { name: 'Join event' }))
    await waitFor(() => expect(within(bar).getByRole('button', { name: 'You’re going!' })).toBeTruthy())
    expect(bar.querySelector('.cs-actionbar-info').textContent).toContain('You’re going!')
  })

  it('shows the waitlist state and Leave waitlist', async () => {
    phone()
    window.history.replaceState({}, '', '/events/7')
    vi.stubGlobal('fetch', fixtureFetch())
    render(<App />)

    const bar = await waitFor(() => {
      const element = document.querySelector('.sticky-action-bar')
      expect(element).toBeTruthy()
      return element
    })
    expect(within(bar).getByText('Waitlisted · #2')).toBeTruthy()
    expect(within(bar).getByRole('button', { name: 'Leave waitlist' })).toBeTruthy()
  })
})
