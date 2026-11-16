// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.jsx'
import { setCsrf } from '../src/api.js'
import { fixtureFetch } from './support/fixtureFetch.js'

// Live page hints: the stream's `signal` events refetch only the screens
// showing that event, in one request per burst.
class FakeStream {
  constructor(url) { this.url = url; this.listeners = {}; FakeStream.last = this }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn) }
  emit(name, data) { (this.listeners[name] || []).forEach(fn => fn({ data: JSON.stringify(data) })) }
  close() {}
}
const reads = (fetch, path) => fetch.mock.calls.filter(([u]) => new URL(String(u), 'http://x').pathname === path).length

beforeEach(() => { setCsrf(null); FakeStream.last = null })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/') })

async function openEvent(id) {
  window.history.replaceState({}, '', `/events/${id}`)
  const fetch = fixtureFetch()
  vi.stubGlobal('fetch', fetch)
  render(<App streamFactory={url => new FakeStream(url)} />)
  await screen.findByRole('heading', { level: 1 })
  await waitFor(() => expect(FakeStream.last).toBeTruthy())
  await waitFor(() => expect(reads(fetch, `/api/v1/events/${id}`)).toBeGreaterThan(0))
  return fetch
}

describe('live page signals', () => {
  it('refetches the open event once per burst of hints for it', async () => {
    const fetch = await openEvent(1)
    const before = reads(fetch, '/api/v1/events/1')
    act(() => {
      FakeStream.last.emit('signal', { topic: 'event', event_id: 1 })
      FakeStream.last.emit('signal', { topic: 'event', event_id: 1 })
      FakeStream.last.emit('signal', { topic: 'event', event_id: 1 })
    })
    await waitFor(() => expect(reads(fetch, '/api/v1/events/1')).toBe(before + 1), { timeout: 2000 })
    await new Promise(resolve => setTimeout(resolve, 900))
    expect(reads(fetch, '/api/v1/events/1')).toBe(before + 1)
  })

  it('ignores hints for other events and other topics', async () => {
    const fetch = await openEvent(1)
    const before = reads(fetch, '/api/v1/events/1')
    act(() => {
      FakeStream.last.emit('signal', { topic: 'event', event_id: 2 })
      FakeStream.last.emit('signal', { topic: 'attendance', event_id: 1 })
    })
    await new Promise(resolve => setTimeout(resolve, 1000))
    expect(reads(fetch, '/api/v1/events/1')).toBe(before)
  })

  it('updates the check-in list live as students arrive', async () => {
    window.history.replaceState({}, '', '/organizer/events/35?tab=checkin')
    const fetch = fixtureFetch()
    vi.stubGlobal('fetch', fetch)
    render(<App streamFactory={url => new FakeStream(url)} />)
    await screen.findByRole('heading', { name: 'Check-in' })
    await waitFor(() => expect(reads(fetch, '/api/v1/events/35/attendance')).toBeGreaterThan(0))
    const before = reads(fetch, '/api/v1/events/35/attendance')
    act(() => FakeStream.last.emit('signal', { topic: 'attendance', event_id: 35 }))
    await waitFor(() => expect(reads(fetch, '/api/v1/events/35/attendance')).toBe(before + 1), { timeout: 2000 })
  })
})
