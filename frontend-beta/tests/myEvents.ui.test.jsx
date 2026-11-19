// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.jsx'
import { setCsrf } from '../src/api.js'
import { sortRegistrations, tabFor } from '../src/lib/myEvents.js'
import { groupByDay, notificationMeta } from '../src/lib/notificationTypes.js'
import { fixtureFetch, json } from './support/fixtureFetch.js'

beforeEach(() => setCsrf(null))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
})

const page = data => json({ data, meta: { page: 1, page_size: 100, total: data.length } })
const calls = (fetch, method) => fetch.mock.calls.filter(([, options]) => options?.method === method)

describe('My events', () => {
  it('sorts registrations into Upcoming, Waitlist and Past', () => {
    const now = new Date('2026-11-16T00:00:00Z')
    const event = (id, start, state = 'published') => ({ id, start_at: start, state })
    const groups = sortRegistrations([
      { event: event(1, '2026-11-20T05:00:00Z'), status: 'joined' },
      { event: event(2, '2026-11-18T05:00:00Z'), status: 'pending' },
      { event: event(3, '2026-11-10T05:00:00Z'), status: 'joined' },
      { event: event(4, '2026-11-25T05:00:00Z'), status: 'joined', },
      { event: event(5, '2026-11-26T05:00:00Z', 'cancelled'), status: 'joined' },
      { event: event(6, '2026-11-27T05:00:00Z'), status: 'unsuccessful' },
    ], now)
    expect(groups.upcoming.map(item => item.event.id)).toEqual([1, 4])
    expect(groups.waitlist.map(item => item.event.id)).toEqual([2])
    expect(groups.past.map(item => item.event.id)).toEqual([6, 5, 3])
    expect(tabFor({ event: event(7, '2026-11-16T00:00:00Z'), status: 'joined' }, now)).toBe('past')
  })

  it('shows tabs with counts, keeps the tab in the URL and supports arrow keys', async () => {
    window.history.replaceState({}, '', '/me/registrations')
    vi.stubGlobal('fetch', fixtureFetch())
    render(<App />)

    const tablist = await screen.findByRole('tablist', { name: 'My events' })
    const upcoming = within(tablist).getByRole('tab', { name: /Upcoming/ })
    await waitFor(() => expect(within(upcoming).getByLabelText('1 events')).toBeTruthy())
    expect(upcoming.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('link', { name: 'Joined event' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Pending registration' })).toBeNull()

    fireEvent.keyDown(upcoming, { key: 'ArrowRight' })
    expect(window.location.search).toBe('?tab=waitlist')
    const waitlist = within(tablist).getByRole('tab', { name: /Waitlist/ })
    expect(waitlist.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(waitlist)
    const card = (await screen.findByRole('link', { name: 'Pending registration' })).closest('article')
    expect(within(card).getByText('Waitlisted · #2')).toBeTruthy()

    fireEvent.click(within(tablist).getByRole('tab', { name: /Past/ }))
    expect(window.location.search).toBe('?tab=past')
    for (const title of ['Autumn exhibition opening', 'Cancelled gathering', 'Left a workshop']) expect(await screen.findByRole('link', { name: title })).toBeTruthy()
    expect(within(screen.getByRole('link', { name: 'Cancelled gathering' }).closest('article')).getByText('Cancelled')).toBeTruthy()
    expect(within(screen.getByRole('link', { name: 'Left a workshop' }).closest('article')).getByText('Left')).toBeTruthy()
  })

  it('offers a way forward when a tab is empty', async () => {
    window.history.replaceState({}, '', '/me/registrations')
    vi.stubGlobal('fetch', fixtureFetch(url => (url.pathname === '/api/v1/me/registrations' ? page([]) : null)))
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'You haven’t joined anything yet' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Explore events' }).getAttribute('href')).toBe('/events')
  })
})

describe('Inbox', () => {
  it('groups typed notifications by day and says how many are unread', async () => {
    window.history.replaceState({}, '', '/notifications')
    vi.stubGlobal('fetch', fixtureFetch())
    render(<App />)

    expect(await screen.findByRole('heading', { level: 2, name: 'Today' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Yesterday' })).toBeTruthy()
    const row = screen.getByRole('heading', { name: /Venue request approved/ }).closest('li')
    expect(within(row).getByText('Venue decision')).toBeTruthy()
    expect(within(row).getByText(/\(unread\)/)).toBeTruthy()
    expect(within(row).getByRole('link', { name: 'View event' }).getAttribute('href')).toBe('/events/21')
    expect(screen.getByText('3 unread in total')).toBeTruthy()
  })

  it('marks every unread message, on every page, as read in one request (MSG-02)', async () => {
    window.history.replaceState({}, '', '/notifications')
    const fetch = fixtureFetch((url, options) => (options.method === 'POST' && url.pathname === '/api/v1/notifications/read-all' ? json({ data: { marked: 3, unread_count: 0 } }) : null))
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    const markAll = await screen.findByRole('button', { name: /Mark all as read/ })
    await waitFor(() => expect(markAll.disabled).toBe(false))
    fireEvent.click(markAll)
    await waitFor(() => expect(calls(fetch, 'POST').filter(([url]) => String(url).endsWith('/notifications/read-all')).length).toBe(1))
    expect(calls(fetch, 'PATCH').length).toBe(0)
    expect((await screen.findAllByText('All caught up.')).length).toBeGreaterThan(0)
  })

  it('marks a read message as unread again (MSG-01)', async () => {
    window.history.replaceState({}, '', '/notifications')
    const fetch = fixtureFetch((url, options) => (options.method === 'DELETE' && url.pathname === '/api/v1/notifications/28/read'
      ? json({ data: { id: 28, read_at: null } }) : null))
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    const row = (await screen.findByRole('heading', { name: 'Tomorrow: Joined event' })).closest('li')
    expect(within(row).queryByRole('button', { name: 'Mark as read' })).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: 'Mark as unread' }))
    await waitFor(() => expect(calls(fetch, 'DELETE').filter(([url]) => String(url).endsWith('/notifications/28/read')).length).toBe(1))
  })

  it('reports when messages could not be marked as read', async () => {
    window.history.replaceState({}, '', '/notifications')
    vi.stubGlobal('fetch', fixtureFetch((url, options) => (options.method === 'POST' && url.pathname === '/api/v1/notifications/read-all'
      ? json({ error: { code: 'INTERNAL_ERROR', message: 'Nope', fields: {}, request_id: 'r' } }, 500)
      : null)))
    render(<App />)

    const markAll = await screen.findByRole('button', { name: /Mark all as read/ })
    await waitFor(() => expect(markAll.disabled).toBe(false))
    fireEvent.click(markAll)
    expect((await screen.findAllByText('Messages weren’t marked as read: Nope')).length).toBeGreaterThan(0)
  })

  it('shows an inbox-zero state that is not an error', async () => {
    window.history.replaceState({}, '', '/notifications')
    vi.stubGlobal('fetch', fixtureFetch(url => (url.pathname === '/api/v1/notifications'
      ? json({ data: [], meta: { page: 1, page_size: 20, total: 0, unread_count: 0 } }) : null)))
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'You’re all caught up' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Mark all as read/ }).disabled).toBe(true)
  })

  it('has an icon and label for every notification type and groups days in campus time', () => {
    for (const type of ['event_published', 'event_changed', 'event_cancelled', 'event_reminder', 'registration_changed', 'booking_requested', 'booking_decided', 'signoff_requested', 'signoff_decided', 'role_changed', 'club_updated', 'checkin_opened', 'activity_digest']) {
      expect(notificationMeta(type).label).not.toBe('Notification')
    }
    expect(notificationMeta('something_new').label).toBe('Notification')
    const now = new Date('2026-11-20T05:00:00Z')
    const groups = groupByDay([
      { id: 1, created_at: '2026-11-20T04:00:00Z' }, { id: 2, created_at: '2026-11-19T16:30:00Z' },
      { id: 3, created_at: '2026-11-19T03:00:00Z' }, { id: 4, created_at: '2026-11-10T03:00:00Z' },
    ], now)
    // 16:30Z on the 19th is 00:30 on the 20th in Hong Kong, so it is still Today.
    expect(groups.map(group => [group.label, group.items.map(item => item.id)])).toEqual([
      ['Today', [1, 2]], ['Yesterday', [3]], ['Tue 10 Nov', [4]],
    ])
  })
})

describe('Clubs and Profile', () => {
  it('asks to join a club with a confirmation toast and leaves with an in-page confirm', async () => {
    window.history.replaceState({}, '', '/clubs')
    const memberships = [
      { club_id: 1, club_name: 'Photography Society', name: 'Photography Society', role: 'committee' },
      { club_id: 3, club_name: 'Chess', name: 'Chess', role: 'member' },
    ]
    const fetch = fixtureFetch((url, options) => {
      if (url.pathname === '/api/v1/me/memberships') return page(memberships)
      if (/membership$/.test(url.pathname) && options.method === 'PUT') return json({ data: { id: 7, club_id: 2, status: 'pending' } }, 202)
      if (/membership$/.test(url.pathname) && options.method) return json({ data: {} }, 200)
      return null
    })
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    const mine = (await screen.findByRole('heading', { name: 'Your clubs' })).closest('section')
    expect(within(mine).getByText('Committee')).toBeTruthy()
    expect(within(mine).getByText(/Committee members leave from the club management page/)).toBeTruthy()
    expect(within(mine).queryByRole('button', { name: 'Leave' })).toBeTruthy() // the plain member club
    const film = (await screen.findByRole('heading', { name: 'Film Society' })).closest('article')
    fireEvent.click(within(film).getByRole('button', { name: 'Request to join' }))
    await waitFor(() => expect(calls(fetch, 'PUT').length).toBe(1))
    expect(new URL(calls(fetch, 'PUT')[0][0], 'http://x').pathname).toBe('/api/v1/clubs/2/membership')
    expect((await screen.findAllByText('Request sent to Film Society.')).length).toBeGreaterThan(0)

    const chess = within(mine).getByRole('button', { name: 'Leave' }).closest('article')
    fireEvent.click(within(chess).getByRole('button', { name: 'Leave' }))
    expect(calls(fetch, 'DELETE').length).toBe(0)
    fireEvent.click(within(chess).getByRole('button', { name: 'Stay in club' }))
    expect(calls(fetch, 'DELETE').length).toBe(0)
    fireEvent.click(within(chess).getByRole('button', { name: 'Leave' }))
    fireEvent.click(within(chess).getByRole('button', { name: 'Leave club' }))
    await waitFor(() => expect(calls(fetch, 'DELETE').length).toBe(1))
  })

  it('moves join and leave out of Profile', async () => {
    window.history.replaceState({}, '', '/profile')
    vi.stubGlobal('fetch', fixtureFetch())
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Your clubs' })).toBeTruthy()
    expect(await screen.findByText('Photography Society')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Join club|Leave club|Request to join/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'Join or leave clubs' }).getAttribute('href')).toBe('/clubs')
  })
})
