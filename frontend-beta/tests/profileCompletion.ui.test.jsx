// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.jsx'
import { setCsrf } from '../src/api.js'
import { fixtureFetch, json } from './support/fixtureFetch.js'

beforeEach(() => setCsrf(null))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/') })

// A Google-signed-in user whose profile is still incomplete: the callback
// created the row with a null student_id, so the session reports it as null.
const incomplete = { user: { id: 9, name: 'Kelly Wong', email: 'kelly@gmail.test', student_id: null, platform_role: 'student' }, memberships: [], csrf_token: 't-incomplete' }
// A password user, untouched by this ticket.
const complete = { user: { id: 1, name: 'Alex Chan', email: 'preview@clubspace.test', student_id: 'PREVIEW-01', platform_role: 'student' }, memberships: [{ club_id: 1, club_name: 'Photography Society', role: 'committee', joined_at: '2026-01-01T00:00:00Z' }], csrf_token: 't-complete' }

const sessionFor = profile => (url) => (url.pathname === '/api/v1/auth/session' ? json({ data: profile }) : null)

describe('profile completion gate', () => {
  it('routes a signed-in user with a null student ID to Profile Completion and keeps them there on other routes', async () => {
    window.history.replaceState({}, '', '/events')
    const fetch = fixtureFetch(sessionFor(incomplete))
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Complete your profile' })).toBeTruthy()
    expect(screen.getByLabelText('Student ID')).toBeTruthy()
    // No app shell around the step: the gate owns the page.
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()

    // Bypassing the gate by navigating directly is not possible.
    window.history.replaceState({}, '', '/profile')
    fireEvent.popState(window)
    expect(await screen.findByRole('heading', { name: 'Complete your profile' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Profile' })).toBeNull()

    window.history.replaceState({}, '', '/clubs')
    fireEvent.popState(window)
    expect(await screen.findByRole('heading', { name: 'Complete your profile' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Discover clubs' })).toBeNull()
    expect(fetch.mock.calls.some(([u, o]) => /\/clubs$/.test(String(u)) && o?.method !== 'DELETE')).toBe(false)
  })

  it('completes the profile with a PATCH, refreshes the session and enters the app', async () => {
    window.history.replaceState({}, '', '/events')
    let completed = false
    const fetch = fixtureFetch((url, options) => {
      if (url.pathname === '/api/v1/profile' && options?.method === 'PATCH') {
        expect(JSON.parse(options.body)).toEqual({ student_id: '3040-777' })
        completed = true
        return json({ data: { ...incomplete.user, student_id: '3040-777' } })
      }
      if (url.pathname === '/api/v1/auth/session') {
        return json({ data: completed ? { ...incomplete, user: { ...incomplete.user, student_id: '3040-777' } } : incomplete })
      }
      return null
    })
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    await screen.findByRole('heading', { name: 'Complete your profile' })
    fireEvent.change(screen.getByLabelText('Student ID'), { target: { value: '3040-777' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Find your next event.' })).toBeTruthy())
    expect(screen.queryByRole('heading', { name: 'Complete your profile' })).toBeNull()
  })

  it('rejects an invalid student ID with the field error and stays on the step', async () => {
    window.history.replaceState({}, '', '/events')
    const fetch = fixtureFetch((url, options) => {
      if (url.pathname === '/api/v1/profile' && options?.method === 'PATCH') {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'Some fields need attention.', fields: { student_id: 'Use letters, digits and hyphens only.' }, request_id: 'r' } }, 422)
      }
      if (url.pathname === '/api/v1/auth/session') return json({ data: incomplete })
      return null
    })
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    await screen.findByRole('heading', { name: 'Complete your profile' })
    fireEvent.change(screen.getByLabelText('Student ID'), { target: { value: 'bad id!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }))
    await waitFor(() => expect(screen.getAllByRole('alert').map(a => a.textContent).join(' ')).toContain('Use letters, digits and hyphens only.'))
    expect(screen.getByRole('heading', { name: 'Complete your profile' })).toBeTruthy()
  })

  it('leaves a password user with a student ID completely unaffected', async () => {
    window.history.replaceState({}, '', '/events')
    const fetch = fixtureFetch(sessionFor(complete))
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Find your next event.' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Complete your profile' })).toBeNull()
    expect(fetch.mock.calls.some(([, o]) => o?.method === 'PATCH')).toBe(false)
  })
})
