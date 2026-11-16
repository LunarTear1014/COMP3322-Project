// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.jsx'
import { setCsrf } from '../src/api.js'
import { buildWeek, weekLabel, weekWindow } from '../src/lib/slots.js'
import { fixtureFetch, json } from './support/fixtureFetch.js'

beforeEach(() => setCsrf(null))
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/') })

const slots = [{ id: 'morning', start: '10:00', end: '12:00' }, { id: 'afternoon', start: '13:00', end: '15:00' }, { id: 'evening', start: '16:00', end: '18:00' }]

describe('slot data', () => {
  it('marks past, booked (by full interval) and available slots', () => {
    const now = new Date('2026-11-18T03:00:00Z') // Wed 11:00 HKT
    const bookings = [{ start_at: '2026-11-19T05:00:00Z', end_at: '2026-11-19T07:00:00Z', busy: true, title: null }]
    const days = buildWeek('2026-11-16', slots, bookings, now)
    expect(days[0].past).toBe(true)
    expect(days[2].slots.map(s => s.status)).toEqual(['past', 'available', 'available'])
    expect(days[3].slots[1]).toMatchObject({ status: 'booked', holder: 'Reserved' })
    expect(days[3].label).toBe('Thursday 19 November')
    expect(weekWindow('2026-11-18')).toMatchObject({ start: '2026-11-16', from: '2026-11-15T16:00:00.000Z', to: '2026-11-22T16:00:00.000Z' })
    expect(weekLabel('2026-11-16')).toBe('16–22 Nov')
  })
})

describe('request flow', () => {
  async function toSlotStep() {
    window.history.replaceState({}, '', '/bookings/new?venue_id=1&date=2026-11-30&slot_id=morning')
  }

  it('disables booked and past slots with their reason, and keeps the week and slot in the URL', async () => {
    // Pin the clock to a Tuesday morning in Hong Kong and open that day: with
    // the real clock, every slot of the first day is past after 18:00, which
    // made this test fail every evening. Only Date is faked, so waitFor runs.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-17T01:00:00Z')) // Tue 09:00 Hong Kong
    window.history.replaceState({}, '', '/bookings/new?venue_id=1&date=2026-11-17')
    vi.stubGlobal('fetch', fixtureFetch())
    render(<App />)
    const picker = await screen.findByRole('group', { name: /^Slots on/ })
    await waitFor(() => expect(within(picker).getAllByRole('button').length).toBe(3))
    const available = within(picker).getAllByRole('button').find(b => !b.disabled)
    fireEvent.click(available)
    expect(window.location.search).toMatch(/venue_id=1.*date=\d{4}-\d\d-\d\d.*slot_id=(morning|afternoon|evening)/)
    expect((await screen.findByRole('button', { name: 'Previous week' })).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(window.location.search).toContain('week=')
    expect((await screen.findByRole('button', { name: 'Previous week' })).disabled).toBe(false)
    vi.useRealTimers()
  })

  it('shows a 409 above the slots, refreshes them and keeps the other fields', async () => {
    await toSlotStep()
    const fetch = fixtureFetch((url, options) => (url.pathname === '/api/v1/events' && options.method === 'POST'
      ? json({ error: { code: 'VENUE_UNAVAILABLE', message: 'Taken.', fields: {}, request_id: 'r' } }, 409) : null))
    vi.stubGlobal('fetch', fetch)
    render(<App />)
    fireEvent.change(await screen.findByRole('combobox', { name: 'Club' }), { target: { value: '1' } })
    await waitFor(() => expect(screen.getByRole('button', { name: /10:00–12:00\s*Selected/ })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Next: event details' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Camera workshop' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Practice.' } })
    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next: review' }))
    const calendarCalls = () => fetch.mock.calls.filter(([u]) => String(u).includes('/calendar')).length
    const before = calendarCalls()
    fireEvent.submit(screen.getByRole('button', { name: 'Submit request' }).closest('form'))

    expect((await screen.findAllByText('That slot was just booked. Pick another time.')).length).toBeGreaterThan(0)
    await waitFor(() => expect(calendarCalls()).toBeGreaterThan(before))
    expect(window.location.search).not.toContain('slot_id')
    expect(screen.getByLabelText('Title').value).toBe('Camera workshop')
    expect(screen.getByLabelText('Capacity').value).toBe('20')
  })

  it('blocks Next with inline errors and capacity above the venue limit', async () => {
    await toSlotStep()
    vi.stubGlobal('fetch', fixtureFetch())
    render(<App />)
    await screen.findByRole('combobox', { name: 'Club' })
    await waitFor(() => expect(screen.getByRole('button', { name: /10:00–12:00\s*Selected/ })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Next: event details' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next: review' }))
    expect(await screen.findByText('Give the event a title.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'x' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'y' } })
    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next: review' }))
    expect(await screen.findByText(/Harbour Room holds up to 80 people/)).toBeTruthy()
  })
})
