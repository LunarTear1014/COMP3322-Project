// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.jsx'
import { setCsrf } from '../src/api.js'
import { tabFor, chipFor } from '../src/lib/myEvents.js'
import { fixtureFetch, json } from './support/fixtureFetch.js'

const decided = (url, options) => (options.method === 'POST' && /\/join-requests\/\d+\/decision$/.test(url.pathname)
  ? json({ data: { event_id: 36, status: 'joined', queue_position: null, joined_count: 5, waitlisted_count: 0 } }) : null)

describe('members-only join requests', () => {
  beforeEach(() => { setCsrf('test-token') })
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/') })

  it('the committee sees the waiting count on People and accepts a request', async () => {
    window.history.replaceState({}, '', '/organizer/events/36?tab=people')
    const fetch = fixtureFetch(decided)
    vi.stubGlobal('fetch', fetch)
    render(<App />)
    expect(await screen.findByLabelText('1 join requests')).toBeTruthy()
    expect(await screen.findByText('Mei Lam')).toBeTruthy()
    expect(screen.getByText(/will take a waitlist place/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(fetch.mock.calls.some(([u, o]) => String(u).endsWith('/events/36/join-requests/5/decision') && o.method === 'POST')).toBe(true))
    const [, options] = fetch.mock.calls.find(([u]) => String(u).endsWith('/decision'))
    expect(JSON.parse(options.body)).toEqual({ decision: 'accept' })
    expect(await screen.findByText('Mei Lam is going.')).toBeTruthy()
  })

  it('rejecting asks for an optional reason before sending', async () => {
    window.history.replaceState({}, '', '/organizer/events/36?tab=people')
    const fetch = fixtureFetch(decided)
    vi.stubGlobal('fetch', fetch)
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))
    expect(fetch.mock.calls.some(([u]) => String(u).endsWith('/decision'))).toBe(false)
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Darkroom team only.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reject request' }))
    await waitFor(() => expect(fetch.mock.calls.some(([u]) => String(u).endsWith('/decision'))).toBe(true))
    const [, options] = fetch.mock.calls.find(([u]) => String(u).endsWith('/decision'))
    expect(JSON.parse(options.body)).toEqual({ decision: 'reject', reason: 'Darkroom team only.' })
  })

  it('a pending request sits in the My events waitlist tab with its own chip', () => {
    const registration = { status: 'requested', event: { start_at: new Date(Date.now() + 86_400_000).toISOString(), state: 'published' } }
    expect(tabFor(registration)).toBe('waitlist')
    expect(chipFor(registration)).toBe('requested')
  })
})
