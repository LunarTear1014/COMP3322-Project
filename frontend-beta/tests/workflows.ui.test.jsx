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
    if (scenario === 'president-log' && url.pathname === '/api/v1/auth/session') {
      resolve(new Response(JSON.stringify({ data: {
        user: { id: 1, name: 'Alex Chan', email: 'preview@clubspace.test', student_id: 'PREVIEW-01', platform_role: 'student' },
        memberships: [{ club_id: 1, club_name: 'Photography Society', role: 'president', version: 3, joined_at: '2026-01-01T00:00:00Z' }],
        csrf_token: 'local-preview-token',
      } }), { status: 200 }))
      return
    }
    if (scenario === 'president-log' && url.pathname === '/api/v1/clubs/1/actions') {
      resolve(new Response(JSON.stringify({ data: [{
        id: 21, type: 'member_removed', description: 'Removed a regular member from the club.',
        actor: { id: 4, name: 'Morgan Lee' }, target: { id: 3, name: 'Riley Chen' },
        undoable: true, created_at: new Date().toISOString(), undone_at: null,
      }], meta: { page: 1, page_size: 20, total: 1 } }), { status: 200 }))
      return
    }
    if (url.pathname === '/api/v1/clubs/1/actions/21/undo' || (url.pathname === '/api/v1/clubs/1/members/3' && options.method === 'DELETE') || (url.pathname === '/api/v1/clubs/1/committee' && options.method === 'DELETE')) {
      resolve(new Response(options.method === 'DELETE' && url.pathname.endsWith('/members/3') ? null : JSON.stringify({ data: {} }), { status: options.method === 'DELETE' && url.pathname.endsWith('/members/3') ? 204 : 200 }))
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
    request.headers = { cookie: scenario === 'admin' ? 'clubspace_preview=admin' : 'clubspace_preview=1' }
    const headers = new Headers()
    const response = {
      statusCode: 200,
      setHeader(name, value) { headers.set(name, value) },
      end(payload) {
        let responsePayload = payload
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

  it('shows the clubs page to committee members and confirms leaving the committee in the page', async () => {
    window.history.replaceState({}, '', '/organizer/clubs')
    const fetch = previewFetch()
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Your clubs' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Clubs' })).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'Photography Society' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Leave committee' }))
    expect(fetch.mock.calls.some(([url, o]) => String(url).endsWith('/clubs/1/committee') && o?.method === 'DELETE')).toBe(false)
    const confirm = screen.getByRole('group', { name: 'Leave the Photography Society committee' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Leave committee' }))
    await waitFor(() => expect(fetch.mock.calls.some(([url, o]) => new URL(url, 'http://localhost').pathname === '/api/v1/clubs/1/committee' && o.method === 'DELETE')).toBe(true))
  })

  it('lets a committee member search the roster and remove a plain member after confirming', async () => {
    window.history.replaceState({}, '', '/organizer/clubs/1/members')
    const fetch = previewFetch()
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    const search = await screen.findByRole('searchbox', { name: 'Search members' })
    fireEvent.change(search, { target: { value: 'riley' } })
    expect(screen.getByText('Riley Chen')).toBeTruthy()
    expect(screen.queryByText('Zara Wong')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Appoint Riley Chen to the committee' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Riley Chen from the club' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Remove Riley Chen from the club' })).getByRole('button', { name: 'Remove from club' }))
    await waitFor(() => {
      const removal = fetch.mock.calls.find(([url, o]) => new URL(url, 'http://localhost').pathname === '/api/v1/clubs/1/members/3' && o?.method === 'DELETE')
      expect(removal).toBeTruthy()
    })
    expect(await screen.findByText('Riley Chen was removed from the club.')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Club activity log' })).toBeNull()
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
    for (const name of ['Booking review', 'Venue schedule']) expect(screen.queryByRole('link', { name })).toBeNull()
  })

  it('shows the president the activity log and undoes an action', async () => {
    window.history.replaceState({}, '', '/organizer/clubs/1/members')
    const fetch = previewFetch('president-log')
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Club activity log' })).toBeTruthy()
    const entry = (await screen.findByText(/Removed a regular member from the club\./)).closest('li')
    expect(within(entry).getByText('Morgan Lee')).toBeTruthy()
    expect(within(entry).getByText(/Affected member: Riley Chen/)).toBeTruthy()
    fireEvent.click(within(entry).getByRole('button', { name: 'Undo: Removed a regular member from the club.' }))
    await waitFor(() => {
      const undo = fetch.mock.calls.find(([url]) => new URL(url, 'http://localhost').pathname === '/api/v1/clubs/1/actions/21/undo')
      expect(undo).toBeTruthy()
      expect(undo[1].method).toBe('POST')
    })
    expect(await screen.findByText('Action undone. Affected members were notified.')).toBeTruthy()
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
    expect(document.querySelector('.selected-slot')).toBeNull()
    expect(window.location.search).not.toMatch(/slot_id|date=/)
    expect(screen.getByText(/original event remains unchanged/i)).toBeTruthy()
  })

  it('shows the Clubs directory to a student with no memberships', async () => {
    window.history.replaceState({}, '', '/clubs')
    vi.stubGlobal('fetch', previewFetch('empty-memberships'))
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Discover clubs' })).toBeTruthy()
    const club = (await screen.findByRole('heading', { name: 'Film Society' })).closest('article')
    expect(within(club).getByRole('button', { name: 'Request to join' })).toBeTruthy()
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
      .toEqual(['06:00–09:00', '09:00–12:00', '12:00–15:00', '15:00–18:00', '18:00–21:00', '06:00–21:00'])
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
    expect(within(previousWeek).getAllByText('Past')).toHaveLength(42)
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(dayPicker.value).toBe(today)

    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    const available = await screen.findAllByRole('link', { name: /^Available, select .* 09:00 to 12:00$/ })
    const selectedSlot = available[0]
    const params = new URL(selectedSlot.href).searchParams
    fireEvent.click(selectedSlot)

    expect(await screen.findByRole('heading', { name: 'Request a venue for an event' })).toBeTruthy()
    const date = params.get('date')
    expect(params.get('venue_id')).toBe('1')
    expect(params.get('slot_id')).toBe('morning')
    expect(window.location.search).toContain(`date=${date}`)
    await waitFor(() => expect(document.querySelector('.selected-slot').textContent).toMatch(/Harbour Room.*09:00–12:00/))
    expect((await screen.findByRole('button', { name: /09:00–12:00\s*Selected/ })).getAttribute('aria-pressed')).toBe('true')
  })


  it('shows venue admins every venue\'s approved bookings by day, with filters and flags', async () => {
    window.history.replaceState({}, '', '/admin/schedule')
    vi.stubGlobal('fetch', previewFetch('admin'))
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Venue schedule' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Venue schedule' }).getAttribute('aria-current')).toBe('page')
    expect(await screen.findByRole('link', { name: 'Campus photo walk' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Film night: stories in motion' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '2 pending requests to review' }).getAttribute('href')).toBe('/admin/bookings')
    expect(screen.getByText(/Today/, { selector: '.calendar-today' })).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Venue'), { target: { value: '2' } })
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Campus photo walk' })).toBeNull())
    expect(screen.getByRole('link', { name: 'Film night: stories in motion' })).toBeTruthy()
    expect(window.location.search).toContain('venue_id=2')

    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    expect(await screen.findByRole('heading', { name: 'Nothing booked this week' })).toBeTruthy()
    expect(window.location.search).toMatch(/week=\d{4}-\d\d-\d\d/)
  })

  // The figures are a lazy chunk that pulls in MUI X charts. Transforming it
  // can take several seconds while the whole suite runs in parallel, so load
  // it first (with its own time allowance); the page's lazy import then
  // resolves from the module cache.
  it('renders report totals and exact values from the preview response', async () => {
    await import('../src/ReportFigures.jsx')
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
  }, 30_000)


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
    for (const name of ['Profile', 'Organizer']) expect(screen.getByRole('link', { name })).toBeTruthy()
    for (const name of ['Booking review', 'Venue schedule']) expect(screen.queryByRole('link', { name })).toBeNull()
    fireEvent.keyDown(screen.getByRole('link', { name: 'Profile' }), { key: 'Escape' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })

  it('gives a venue administrator the venue tools and no organizer link', async () => {
    window.history.replaceState({}, '', '/events')
    vi.stubGlobal('fetch', previewFetch('admin'))
    render(<App />)

    await screen.findByRole('heading', { name: 'Find your next event.' })
    fireEvent.click(screen.getByRole('button', { name: /Account/ }))
    for (const name of ['Profile', 'Booking review', 'Venue schedule']) expect(screen.getByRole('link', { name })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Organizer' })).toBeNull()
  })

  it('swaps My events for Schedule in a venue administrator\'s bottom bar', async () => {
    window.matchMedia = query => ({ matches: query.includes('max-width: 767.98px'), addEventListener() {}, removeEventListener() {} })
    window.history.replaceState({}, '', '/admin/schedule')
    vi.stubGlobal('fetch', previewFetch('admin'))
    render(<App />)

    const bar = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(bar).getAllByRole('link').map(link => link.textContent.replace(/\d.*$/, '').trim())).toEqual(['Explore', 'Schedule', 'Clubs', 'Inbox'])
    expect(within(bar).getByRole('link', { name: 'Schedule' }).getAttribute('href')).toBe('/admin/schedule')
    expect(within(bar).getByRole('link', { name: 'Schedule' }).getAttribute('aria-current')).toBe('page')
    expect(within(bar).queryByRole('link', { name: /My events/ })).toBeNull()
    expect(document.documentElement.style.getPropertyValue('--bars-height')).toBe('68px')
    delete window.matchMedia
  })

  it('shows a venue administrator the event without a way to register, and a way to manage it', async () => {
    window.history.replaceState({}, '', '/events/1')
    vi.stubGlobal('fetch', previewFetch('admin'))
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Campus photo walk' })).toBeTruthy()
    expect((await screen.findAllByText('Venue administrators manage events and don’t register for them.')).length).toBeGreaterThan(0)
    for (const name of [/^Join event/, /Join waitlist/, /Request to join/]) expect(screen.queryByRole('button', { name })).toBeNull()
    expect(screen.getByRole('link', { name: 'Manage event' }).getAttribute('href')).toBe('/organizer/events/1')
  })

  it('offers a venue administrator no way to join a club', async () => {
    window.history.replaceState({}, '', '/clubs')
    vi.stubGlobal('fetch', previewFetch('admin'))
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Film Society' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Request to join/ })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Your clubs' })).toBeNull()
  })

  it('shows a student their join action on the same event and clubs', async () => {
    window.history.replaceState({}, '', '/clubs')
    vi.stubGlobal('fetch', previewFetch())
    render(<App />)
    expect((await screen.findAllByRole('button', { name: /Request to join/ })).length).toBeGreaterThan(0)
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
    window.history.replaceState({}, '', '/organizer/events/1?tab=edit')
    vi.stubGlobal('fetch', previewFetch())
    render(<App />)

    const title = await screen.findByRole('textbox', { name: 'Title' })
    fireEvent.change(title, { target: { value: 'Unsaved first event title' } })
    window.history.pushState({}, '', '/organizer/events/2?tab=edit')
    fireEvent.popState(window)
    await screen.findByRole('heading', { name: 'Film night: stories in motion' })
    // Event 2 belongs to Film Society, where this account has no club role:
    // no editor is mounted for it (F02), and nothing from event 1 lingers.
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull())
    expect(screen.queryByDisplayValue('Unsaved first event title')).toBeNull()
  })

  it('preserves request fields after an unsuccessful submission', async () => {
    window.history.replaceState({}, '', '/bookings/new?venue_id=1&date=2026-11-30&slot_id=morning')
    vi.stubGlobal('fetch', previewFetch())
    render(<App />)

    const club = await screen.findByRole('combobox', { name: 'Club' })
    fireEvent.change(club, { target: { value: '1' } })
    await waitFor(() => expect(screen.getByRole('button', { name: /09:00–12:00\s*Selected/ })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Next: event details' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Camera workshop' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'A practical session.' } })
    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next: review' }))
    // A campus tag is required (TAG-01): Review is blocked until one is chosen.
    expect((await screen.findAllByText('Choose 1 to 3 campus tags.')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Submit request' })).toBeNull()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Arts' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next: review' }))
    // Review lists the deadline and tags (F17) and says the president signs off first (F03).
    expect(await screen.findByText('When the event starts')).toBeTruthy()
    expect(screen.getByText('Tags').nextElementSibling.textContent).toBe('Arts')
    expect(screen.getByText(/Your president signs this request off first/)).toBeTruthy()
    fireEvent.submit(screen.getByRole('button', { name: 'Submit request' }).closest('form'))

    expect((await screen.findByRole('alert')).textContent).toContain('read-only preview')
    expect(screen.getByLabelText('Title').value).toBe('Camera workshop')
    expect(screen.getByLabelText('Capacity').value).toBe('20')
    expect(window.location.search).toContain('date=2026-11-30')
  })

  it('retains a decision reason after a booking conflict', async () => {
    window.history.replaceState({}, '', '/admin/bookings')
    vi.stubGlobal('fetch', previewFetch('admin'))
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Review Student film showcase and conversation with emerging filmmakers' }))
    const dialog = await screen.findByRole('dialog', { name: 'Review request' })
    expect(within(dialog).getByRole('button', { name: 'Reject' })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }))
    expect(within(dialog).getByRole('button', { name: 'Reject request' }).disabled).toBe(true)
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Reason for rejecting/ }), { target: { value: 'Please check the venue.' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject request' }))

    expect(await within(dialog).findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('no longer available'))
    await waitFor(() => expect(within(dialog).getByRole('textbox').value).toBe('Please check the venue.'))
  })
})
