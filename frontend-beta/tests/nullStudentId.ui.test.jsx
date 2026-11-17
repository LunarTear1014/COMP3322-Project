// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.jsx'
import { setCsrf } from '../src/api.js'
import { fixtureFetch, json } from './support/fixtureFetch.js'

beforeEach(() => setCsrf('test-token'))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/') })

// Session for a completed user. The Profile Completion gate in App.jsx owns the
// page when the session user's own student_id is null, so these consumers are
// tested through a completed session user while the *other* users in the data
// still carry a null student_id — that is the case the panels must render.
const sessionUser = { id: 1, name: 'Alex Chan', email: 'preview@clubspace.test', student_id: 'PREVIEW-01', platform_role: 'student' }
const session = { user: sessionUser, memberships: [{ club_id: 1, club_name: 'Photography Society', role: 'committee', joined_at: '2026-01-01T00:00:00Z' }], csrf_token: 't-null' }

const withOverrides = (override) => (url, options) => {
  if (url.pathname === '/api/v1/auth/session') return json({ data: session })
  return override?.(url, options) ?? null
}

describe('null student_id rendering', () => {
  it('Profile page shows a placeholder rather than a dangling "Student ID:" label', async () => {
    window.history.replaceState({}, '', '/profile')
    const fetch = fixtureFetch((url) => {
      if (url.pathname === '/api/v1/profile') return json({ data: { ...sessionUser, student_id: null } })
      if (url.pathname === '/api/v1/me/memberships') return json({ data: [], meta: { page: 1, page_size: 100, total: 0 } })
      return null
    })
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    const meta = await screen.findByText((content, element) => element?.classList.contains('cs-meta') && element.textContent.includes('Student ID:'))
    expect(meta.textContent).toContain('Student ID: —')
  })

  it('Join requests panel renders a placeholder for a requester with a null student ID', async () => {
    window.history.replaceState({}, '', '/organizer/events/36?tab=people')
    const fetch = fixtureFetch(withOverrides((url) => (
      url.pathname === '/api/v1/events/36/join-requests'
        ? json({ data: [{ user: { id: 5, name: 'Mei Lam', email: 'mei@example.test', student_id: null }, allow_waitlist: true, requested_at: '2026-11-17T12:00:00Z' }], meta: { page: 1, page_size: 20, total: 1 } })
        : null
    )))
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    const row = (await screen.findByText('Mei Lam')).closest('li')
    await waitFor(() => expect(within(row).getByText((_, element) => element?.classList.contains('cs-meta') && element.textContent.includes('asked')).textContent).toContain('— · asked'))
  })

  it('Participants table renders a placeholder for a participant with a null student ID', async () => {
    window.history.replaceState({}, '', '/organizer/events/35?tab=people')
    const fetch = fixtureFetch(withOverrides((url) => (
      url.pathname === '/api/v1/events/35/participants'
        ? json({ data: [{ user: { id: 3, name: 'Riley Chen', email: 'riley@example.test', student_id: null }, status: 'joined', queue_position: null }], meta: { page: 1, page_size: 20, total: 1 } })
        : null
    )))
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    const table = await screen.findByRole('region', { name: 'Participants' }).then(r => within(r).getByRole('table'))
    const row = within(table).getByRole('row', { name: /Riley Chen/ })
    const cells = within(row).getAllByRole('cell').map(cell => cell.textContent)
    expect(cells[cells.indexOf('—') - 1]).toBe('riley@example.test', 'the Student ID cell right after the email shows the placeholder')
  })
})
