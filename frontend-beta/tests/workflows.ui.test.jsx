// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from '../src/App.jsx'
import { campusDate, setCsrf } from '../src/api.js'
import { fixturePlugin } from '../dev/fixtures.js'

let fixtureHandler
fixturePlugin().configureServer({ middlewares: { use(_path, handler) { fixtureHandler = handler } } })

function previewFetch(scenario = '') {
  let profileReads = 0
  return vi.fn((input, options = {}) => new Promise(resolve => {
    const url = new URL(input, 'http://localhost')
    if (scenario === 'join-request-notification' && url.pathname === '/api/v1/notifications') {
      resolve(new Response(JSON.stringify({
        data: [{
          id: 8,
          club_id: 1,
          join_request_id: 14,
          type: 'club_join_request',
          title: 'Join request: Photography Society',
          body: 'Sam Lee requested to join Photography Society.',
          created_at: new Date().toISOString(),
          read_at: null,
        }],
        meta: { page: 1, page_size: 20, total: 1, unread_count: 1 },
      }), { status: 200 }))
      return
    }
    if (scenario === 'join-request-notification' && url.pathname === '/api/v1/clubs/1/join-requests/14/review') {
      resolve(new Response(JSON.stringify({ data: { message: 'Join request approved.' } }), { status: 200 }))
      return
    }
    if (scenario === 'club-members' && url.pathname === '/api/v1/clubs/1/members' && options.method !== 'POST') {
      resolve(new Response(JSON.stringify({ data: [
        { user_id: 1, name: 'Alex Chan', role: 'committee' },
        { user_id: 3, name: 'Riley Chen', role: 'member' },
        { user_id: 4, name: 'Zara Wong', role: 'member' },
      ] }), { status: 200 }))
      return
    }
    if (scenario === 'club-members' && url.pathname === '/api/v1/clubs/1/members/3/committee') {
      resolve(new Response(JSON.stringify({ data: { message: 'Member promoted to committee.' } }), { status: 200 }))
      return
    }
    if (scenario === 'club-members' && url.pathname === '/api/v1/clubs/1/members/3' && options.method === 'DELETE') {
      resolve(new Response(JSON.stringify({ data: { message: 'Member removed from the club.' } }), { status: 200 }))
      return
    }
    if (scenario === 'president' && url.pathname === '/api/v1/clubs/2/members/3/committee' && options.method === 'DELETE') {
      resolve(new Response(JSON.stringify({ data: { message: 'Member returned to regular member role.' } }), { status: 200 }))
      return
    }
    if (scenario === 'president' && url.pathname === '/api/v1/clubs/2/actions') {
      resolve(new Response(JSON.stringify({ data: [{
        id: 21,
        actor_name: 'Morgan Lee',
        target_name: 'Riley Chen',
        action_type: 'member_removed',
        description: 'Removed a regular member from the club.',
        undoable: true,
        created_at: new Date().toISOString(),
        undone_at: null,
      }] }), { status: 200 }))
      return
    }
    if (scenario === 'president' && url.pathname === '/api/v1/clubs/2/actions/21/undo') {
      resolve(new Response(JSON.stringify({ data: { message: 'Action undone. Affected members have been notified.' } }), { status: 200 }))
      return
    }
    if (scenario === 'student' && url.pathname === '/api/v1/auth/session') {
      url.searchParams.set('preview', 'student')
    }
    if (scenario === 'profile-refresh-failure' && url.pathname === '/api/v1/profile') {
      if (options.method === 'PATCH') {
        resolve(new Response(JSON.stringify({ error: { code: 'EMAIL_IN_USE', message: 'Email is already in use.', fields: {} } }), { status: 409 }))
        return
      }
      profileReads += 1
      if (profileReads > 1) {
        resolve(new Response(JSON.stringify({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Profile temporarily unavailable.', fields: {} } }), { status: 503 }))
        return
      }
    }
    if (scenario === 'empty-memberships' && url.pathname === '/api/v1/me/memberships') {
      url.searchParams.set('preview', 'empty')
    }
    const body = options.body || ''
    const request = Readable.from(body ? [body] : [])
    request.url = `${url.pathname.replace('/api/v1', '')}${url.search}`
    request.method = options.method || 'GET'
    request.headers = { cookie: 'clubspace_preview=1' }
    const headers = new Headers()
    const response = {
      statusCode: 200,
      setHeader(name, value) { headers.set(name, value) },
      end(payload) {
        let responsePayload = payload
        if (scenario === 'president' && request.url.startsWith('/me/memberships')) {
          const result = JSON.parse(payload)
          result.data.push({ club_id: 2, name: 'Film Society', description: 'Screenings and conversations for film lovers.', role: 'president' })
          responsePayload = JSON.stringify(result)
        }
        resolve({
          status: this.statusCode,
          ok: this.statusCode >= 200 && this.statusCode < 300,
          headers,
          json: async () => JSON.parse(responsePayload),
        })
      },
    }
    fixtureHandler(request, response)
  }))
}

beforeEach(() => {
  setCsrf(null)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
})

describe('frontend preview workflows', () => {

  it('shows the clubs page to committee members', async () => {
    window.history.replaceState({}, '', '/organizer/clubs')
    vi.stubGlobal('fetch', previewFetch())
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Your clubs' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Clubs' })).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'Photography Society' })).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Leave committee' })).toBeTruthy()
  })

  it('lets committee members see the roster and promote a member', async () => {
    window.history.replaceState({}, '', '/organizer/clubs')
    const fetch = previewFetch('club-members')
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    fireEvent.click(await screen.findByText('Club members (3)'))
    const search = await screen.findByRole('searchbox', { name: 'Search Photography Society members' })
    fireEvent.change(search, { target: { value: 'riley' } })
    expect(await screen.findByText('Riley Chen · member')).toBeTruthy()
    expect(screen.queryByText('Zara Wong · member')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Make committee' }))

    await waitFor(() => {
      const promotion = fetch.mock.calls.find(([url]) => new URL(url, 'http://localhost').pathname === '/api/v1/clubs/1/members/3/committee')
      expect(promotion).toBeTruthy()
      expect(promotion[1].method).toBe('POST')
    })
    expect(await screen.findByText('Riley Chen was promoted to the Photography Society committee.')).toBeTruthy()
  })

  it('lets a committee member remove a regular member', async () => {
    window.history.replaceState({}, '', '/organizer/clubs')
    const fetch = previewFetch('club-members')
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    fireEvent.click(await screen.findByText('Club members (3)'))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Riley Chen from club' }))

    await waitFor(() => {
      const removal = fetch.mock.calls.find(([url]) => new URL(url, 'http://localhost').pathname === '/api/v1/clubs/1/members/3')
      expect(removal).toBeTruthy()
      expect(removal[1].method).toBe('DELETE')
    })
    expect(await screen.findByText('Riley Chen was removed from Photography Society.')).toBeTruthy()
  })

  it('keeps role tools out of a student\'s account menu and sends management links to the directory', async () => {
    window.history.replaceState({}, '', '/organizer/clubs?preview=student')
    vi.stubGlobal('fetch', previewFetch('student'))
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Clubs' })).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'Your clubs' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Clubs' }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(screen.getByRole('button', { name: /Account/ }))
    expect(screen.getByRole('link', { name: 'Profile' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Organizer' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull()
  })

  it('lets a president choose a committee successor and confirm the transfer', async () => {
    window.history.replaceState({}, '', '/organizer/clubs')
    const fetch = previewFetch('president')
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Film Society' })).toBeTruthy()
    fireEvent.change(await screen.findByLabelText('New president'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText(/Type.*Film Society.*to confirm/i), { target: { value: 'Film Society' } })
    fireEvent.click(screen.getByRole('button', { name: 'Transfer presidency' }))

    await waitFor(() => {
      const transfer = fetch.mock.calls.find(([url]) => new URL(url, 'http://localhost').pathname === '/api/v1/clubs/2/presidency')
      expect(transfer).toBeTruthy()
      expect(transfer[1].method).toBe('POST')
      expect(JSON.parse(transfer[1].body)).toEqual({ user_id: 3, confirmation: 'Film Society' })
    })
  })

  it('lets a president demote a committee member', async () => {
    window.history.replaceState({}, '', '/organizer/clubs')
    const fetch = previewFetch('president')
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    fireEvent.click(await screen.findByText('Club members (1)'))
    fireEvent.click(await screen.findByRole('button', { name: 'Demote Morgan Lee to member' }))

    await waitFor(() => {
      const demotion = fetch.mock.calls.find(([url]) => new URL(url, 'http://localhost').pathname === '/api/v1/clubs/2/members/3/committee')
      expect(demotion).toBeTruthy()
      expect(demotion[1].method).toBe('DELETE')
    })
    expect(await screen.findByText('Morgan Lee was returned to regular member status.')).toBeTruthy()
  })

  it('shows the president who performed an action and allows undo', async () => {
    window.history.replaceState({}, '', '/organizer/clubs')
    const fetch = previewFetch('president')
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    fireEvent.click(await screen.findByText('Club activity log'))
    const description = await screen.findByText((_, element) => element.tagName === 'P' && element.textContent.includes('Removed a regular member from the club.'))
    expect(within(description.closest('article')).getByText('Morgan Lee')).toBeTruthy()
    expect(within(description.closest('article')).getByText(/Affected member: Riley Chen/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Undo action' }))

    await waitFor(() => {
      const undo = fetch.mock.calls.find(([url]) => new URL(url, 'http://localhost').pathname === '/api/v1/clubs/2/actions/21/undo')
      expect(undo).toBeTruthy()
      expect(undo[1].method).toBe('POST')
    })
    expect(await screen.findByText('Action undone. Affected members have been notified.')).toBeTruthy()
  })

  it('shows join request notifications with approve and reject actions', async () => {
    window.history.replaceState({}, '', '/notifications')
    const fetch = previewFetch('join-request-notification')
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    expect(await screen.findByText('Sam Lee requested to join Photography Society.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Approve request' }))
    await waitFor(() => {
      const review = fetch.mock.calls.find(([url]) => new URL(url, 'http://localhost').pathname === '/api/v1/clubs/1/join-requests/14/review')
      expect(review).toBeTruthy()
      expect(review[1].method).toBe('POST')
      expect(JSON.parse(review[1].body)).toEqual({ decision: 'accept' })
    })
  })

  it('opens an event from discovery and reports a failed registration', async () => {
    window.history.replaceState({}, '', '/events')
    vi.stubGlobal('fetch', previewFetch())
    render(<App />)

    fireEvent.click(await screen.findByRole('link', { name: 'Campus photo walk' }))
    expect(await screen.findByRole('heading', { name: 'Campus photo walk' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Join event' }))
    expect((await screen.findByRole('alert')).textContent).toContain('read-only preview')
  })

  it('shows managed events and links to the request and reports', async () => {
    window.history.replaceState({}, '', '/organizer')
    vi.stubGlobal('fetch', previewFetch())
    render(<App />)

    expect(await screen.findByRole('link', { name: 'Campus photo walk' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Request a venue and create a draft' }).getAttribute('href')).toBe('/bookings/new')
    expect(screen.getByRole('link', { name: 'Photography Society' }).getAttribute('href')).toBe('/organizer/clubs/1/reports')
  })

  it('copies event details into a new request without copying the booking time', async () => {
    window.history.replaceState({}, '', '/organizer/events/1')
    vi.stubGlobal('fetch', previewFetch())
    render(<App />)

    fireEvent.click(await screen.findByRole('link', { name: 'Copy details to a new request' }))
    expect(await screen.findByRole('heading', { name: 'Request a venue for an event' })).toBeTruthy()
    expect(screen.getByLabelText('Title').value).toBe('Campus photo walk')
    expect(screen.getByLabelText('Club').value).toBe('1')
    expect(screen.getByLabelText('Venue').value).toBe('1')
    expect(screen.getByLabelText('Date').value).toBe('')
    expect(screen.getByLabelText('Slot').value).toBe('')
    expect(screen.getByText(/original event remains unchanged/i)).toBeTruthy()
  })

  it('shows the Clubs directory to a student with no memberships', async () => {
    window.history.replaceState({}, '', '/clubs')
    vi.stubGlobal('fetch', previewFetch('empty-memberships'))
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Discover clubs' })).toBeTruthy()
    const club = (await screen.findByRole('heading', { name: 'Film Society' })).closest('article')
    expect(within(club).getByRole('button', { name: 'Join club' })).toBeTruthy()
  })

  it('shows a recoverable error if the profile refresh fails after a conflict', async () => {
    window.history.replaceState({}, '', '/profile')
    vi.stubGlobal('fetch', previewFetch('profile-refresh-failure'))
    render(<App />)

    await screen.findByDisplayValue('Alex Chan')
    fireEvent.submit(screen.getByRole('button', { name: 'Save profile' }).closest('form'))

    expect(await screen.findByText('Profile temporarily unavailable.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Your clubs' })).toBeTruthy()
  })

  it('navigates calendar weeks and carries the selected slot to the request form', async () => {
    window.history.replaceState({}, '', '/venues/1/calendar')
    vi.stubGlobal('fetch', previewFetch())
    render(<App />)

    const table = await screen.findByRole('table', { name: 'Harbour Room time slots' })
    expect(within(table).getAllByRole('columnheader')).toHaveLength(8)
    expect(within(table).getAllByRole('rowheader').map(header => header.textContent))
      .toEqual(['10:00–12:00', '13:00–15:00', '16:00–18:00'])
    const today = campusDate(new Date())
    expect(table.querySelector('time[aria-current="date"]').dateTime).toBe(today)
    const dayPicker = screen.getByLabelText('Choose a day')
    const anotherDay = [...dayPicker.options].find(option => option.value !== today)
    fireEvent.change(dayPicker, { target: { value: anotherDay.value } })
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(dayPicker.value).toBe(today)

    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    const previousWeek = await screen.findByRole('table', { name: 'Harbour Room time slots' })
    expect(previousWeek.querySelector('time[aria-current="date"]')).toBeNull()
    expect(within(previousWeek).getAllByText('Past')).toHaveLength(21)
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(dayPicker.value).toBe(today)

    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    const available = await screen.findAllByRole('link', { name: /^Available, select .* 10:00 to 12:00$/ })
    const selectedSlot = available[0]
    const params = new URL(selectedSlot.href).searchParams
    fireEvent.click(selectedSlot)

    expect(await screen.findByRole('heading', { name: 'Request a venue for an event' })).toBeTruthy()
    const date = params.get('date')
    expect(params.get('venue_id')).toBe('1')
    expect(params.get('slot_id')).toBe('morning')
    expect(screen.getByDisplayValue(date)).toBeTruthy()
    expect(screen.getByText(new RegExp(`Harbour Room.*${date}.*10:00–12:00`))).toBeTruthy()
  })


  it('renders report totals and exact values from the preview response', async () => {
    window.history.replaceState({}, '', '/organizer/clubs/1/reports')
    vi.stubGlobal('fetch', previewFetch())
    render(<App />)

    expect(await screen.findByText(/1 event.*18 currently joined/)).toBeTruthy()
    const disclosure = await screen.findByText('View daily action data')
    fireEvent.click(disclosure)
    const actionSection = screen.getByRole('heading', { name: 'Daily registration actions' }).closest('section')
    expect(within(actionSection).getByRole('cell', { name: '4' })).toBeTruthy()
    const hoursSection = screen.getByRole('heading', { name: 'Confirmed venue hours' }).closest('section')
    expect(within(hoursSection).getByRole('cell', { name: '1.5' })).toBeTruthy()
  })


  it('refreshes the report for a new period and identifies incomplete history', async () => {
    window.history.replaceState({}, '', '/organizer/clubs/1/reports')
    vi.stubGlobal('fetch', previewFetch())
    render(<App />)

    expect(await screen.findByText(/1 event.*18 currently joined/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2025-12-30' } })
    fireEvent.change(screen.getByLabelText('Until (exclusive)'), { target: { value: '2026-01-05' } })

    expect(await screen.findByText('No events in this period.')).toBeTruthy()
    expect(screen.getByText(/Earlier history is incomplete for this period/)).toBeTruthy()
    expect(screen.getByText(/0 events.*0 currently joined/)).toBeTruthy()
  })

  it('shows a four-tab bottom bar on phones with the unread count', async () => {
    window.matchMedia = query => ({ matches: query.includes('max-width: 767.98px'), addEventListener() {}, removeEventListener() {} })
    window.history.replaceState({}, '', '/me/registrations')
    vi.stubGlobal('fetch', previewFetch())
    render(<App />)

    const bar = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(bar).getAllByRole('link').map(link => link.textContent.replace(/\d.*$/, '').trim())).toEqual(['Explore', 'My events', 'Clubs', 'Inbox'])
    expect(within(bar).getByRole('link', { name: /My events/ }).getAttribute('aria-current')).toBe('page')
    expect(within(bar).getByRole('link', { name: 'Explore' }).getAttribute('aria-current')).toBeNull()
    expect(await within(bar).findByText(', 3 unread')).toBeTruthy()
    expect(document.documentElement.style.getPropertyValue('--bars-height')).toBe('68px')
    delete window.matchMedia
  })


  it('opens the account menu with role tools and restores focus to its trigger on Escape', async () => {
    window.history.replaceState({}, '', '/events')
    vi.stubGlobal('fetch', previewFetch())
    render(<App />)

    await screen.findByRole('heading', { name: 'Find your next event.' })
    const trigger = screen.getByRole('button', { name: /Account/ })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    for (const name of ['Profile', 'Organizer', 'Admin']) expect(screen.getByRole('link', { name })).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('link', { name: 'Profile' }), { key: 'Escape' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })

  it('hides the Inbox badge at zero unread and shows header links on desktop', async () => {
    window.history.replaceState({}, '', '/events')
    const preview = previewFetch()
    vi.stubGlobal('fetch', vi.fn((input, options) => String(input).includes('/notifications')
      ? Promise.resolve(new Response(JSON.stringify({ data: [], meta: { page: 1, page_size: 1, total: 0, unread_count: 0 } }), { status: 200 }))
      : preview(input, options)))
    render(<App />)

    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).getAllByRole('link').length).toBe(4)
    expect(within(nav).getByRole('link', { name: 'Inbox' })).toBeTruthy()
    expect(within(nav).queryByText(/unread/)).toBeNull()
  })

  it('loads the correct editor values when switching between event IDs', async () => {
    window.history.replaceState({}, '', '/organizer/events/1')
    vi.stubGlobal('fetch', previewFetch())
    render(<App />)

    const title = await screen.findByRole('textbox', { name: 'Title' })
    fireEvent.change(title, { target: { value: 'Unsaved first event title' } })
    window.history.pushState({}, '', '/organizer/events/2')
    fireEvent.popState(window)
    await screen.findByRole('heading', { name: 'Film night: stories in motion' })
    expect((await screen.findByRole('textbox', { name: 'Title' })).value).toBe('Film night: stories in motion')
  })

  it('preserves request fields after an unsuccessful submission', async () => {
    window.history.replaceState({}, '', '/bookings/new?venue_id=1&date=2026-11-30&slot_id=morning')
    vi.stubGlobal('fetch', previewFetch())
    render(<App />)

    const club = await screen.findByRole('combobox', { name: 'Club' })
    fireEvent.change(club, { target: { value: '1' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Camera workshop' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), { target: { value: 'A practical session.' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Capacity' }), { target: { value: '20' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Submit request' }).closest('form'))

    expect((await screen.findByRole('alert')).textContent).toContain('read-only preview')
    expect(screen.getByRole('textbox', { name: 'Title' }).value).toBe('Camera workshop')
    expect(screen.getByRole('spinbutton', { name: 'Capacity' }).value).toBe('20')
    expect(screen.getByDisplayValue('2026-11-30')).toBeTruthy()
  })

  it('retains a decision reason after a booking conflict', async () => {
    window.history.replaceState({}, '', '/admin/bookings')
    vi.stubGlobal('fetch', previewFetch())
    render(<App />)

    const title = await screen.findByRole('heading', { name: 'Student film showcase and conversation with emerging filmmakers' })
    const request = title.closest('article')
    const reason = within(request).getByRole('textbox', { name: 'Decision reason (required for rejection)' })
    fireEvent.change(reason, { target: { value: 'Please check the venue.' } })
    fireEvent.click(within(request).getByRole('button', { name: 'Approve' }))

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('no longer available'))
    await waitFor(() => expect(within(request).getByRole('textbox').value).toBe('Please check the venue.'))
  })
})
