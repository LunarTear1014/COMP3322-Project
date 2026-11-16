// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.jsx'
import { setCsrf } from '../src/api.js'
import { FALLBACK_POLL_MS, STREAM_URL } from '../src/hooks/useLiveInbox.js'
import { fixtureFetch } from './support/fixtureFetch.js'

class FakeStream {
  constructor(url) { this.url = url; this.listeners = {}; this.closed = false; FakeStream.last = this }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn) }
  emit(name, data) { (this.listeners[name] || []).forEach(fn => fn({ data: data === undefined ? undefined : JSON.stringify(data) })) }
  close() { this.closed = true }
}
const inboxCalls = fetch => fetch.mock.calls.filter(([u]) => String(u).includes('/notifications?page=1&page_size=1')).length

beforeEach(() => { setCsrf(null); FakeStream.last = null })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/') })

async function open() {
  window.history.replaceState({}, '', '/events')
  const fetch = fixtureFetch()
  vi.stubGlobal('fetch', fetch)
  render(<App streamFactory={url => new FakeStream(url)} />)
  await screen.findByRole('toolbar', { name: 'Event filters' })
  await waitFor(() => expect(FakeStream.last).toBeTruthy())
  return fetch
}

describe('live inbox', () => {
  it('opens the stream, updates the badge from pushed events and toasts the title', async () => {
    await open()
    expect(FakeStream.last.url).toBe(STREAM_URL)
    await screen.findByText(', 3 unread')
    act(() => FakeStream.last.emit('notification', { unread_count: 4, notification: { id: 40, title: 'New event: Hike' } }))
    expect(await screen.findByText(', 4 unread')).toBeTruthy()
    expect((await screen.findAllByText('New event: Hike')).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'View' })).toBeTruthy()
  })

  it('refetches the count when the server says the gap was too large', async () => {
    const fetch = await open()
    const before = inboxCalls(fetch)
    act(() => FakeStream.last.emit('refetch'))
    await waitFor(() => expect(inboxCalls(fetch)).toBeGreaterThan(before))
  })

  it('falls back to 60 s polling when the stream errors and stops when it reopens', async () => {
    const fetch = await open()
    vi.useFakeTimers()
    const base = inboxCalls(fetch)
    act(() => FakeStream.last.emit('error'))
    expect(inboxCalls(fetch)).toBe(base + 1)
    act(() => { vi.advanceTimersByTime(FALLBACK_POLL_MS - 1) })
    expect(inboxCalls(fetch)).toBe(base + 1)
    act(() => { vi.advanceTimersByTime(2) })
    expect(inboxCalls(fetch)).toBe(base + 2)
    act(() => FakeStream.last.emit('open'))
    act(() => { vi.advanceTimersByTime(FALLBACK_POLL_MS * 3) })
    expect(inboxCalls(fetch)).toBe(base + 2)
  })

  it('closes the stream when the user signs out of the page', async () => {
    await open()
    const stream = FakeStream.last
    cleanup()
    expect(stream.closed).toBe(true)
  })

  it('without EventSource support it polls every 60 s, not every 30 s', async () => {
    window.history.replaceState({}, '', '/events')
    const fetch = fixtureFetch()
    vi.stubGlobal('fetch', fetch)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<App />)
    await screen.findByRole('toolbar', { name: 'Event filters' })
    await waitFor(() => expect(inboxCalls(fetch)).toBeGreaterThanOrEqual(1))
    const base = inboxCalls(fetch)
    act(() => { vi.advanceTimersByTime(45000) }) // a 30 s poll would have fired by now
    expect(inboxCalls(fetch)).toBe(base)
    act(() => { vi.advanceTimersByTime(16000) })
    expect(inboxCalls(fetch)).toBe(base + 1)
  })
})
