// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import App from '../src/App.jsx'
import { setCsrf } from '../src/api.js'
import { fixtureFetch, json } from './support/fixtureFetch.js'

beforeEach(() => setCsrf(null))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/') })

// Signed out, so the shell renders the auth page; /config answers with the
// Google flag under test.
const signedOut = url => (url.pathname === '/api/v1/auth/session'
  ? json({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'Sign in.', fields: {} } }, 401) : null)
const withConfig = google_oauth_enabled => (url, options) => {
  if (url.pathname === '/api/v1/config') return json({ data: { campus_timezone: 'Asia/Hong_Kong', slots: [], google_oauth_enabled } })
  return signedOut(url, options)
}

describe('Google sign-in on the auth page', () => {
  it('hides the Continue with Google button when OAuth is disabled', async () => {
    window.history.replaceState({}, '', '/login')
    vi.stubGlobal('fetch', fixtureFetch(withConfig(false)))
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Continue with Google/ })).toBeNull()
  })

  it('shows the Continue with Google button when OAuth is enabled', async () => {
    window.history.replaceState({}, '', '/login')
    vi.stubGlobal('fetch', fixtureFetch(withConfig(true)))
    render(<App />)
    const button = await screen.findByRole('link', { name: /Continue with Google/ })
    expect(button.getAttribute('href')).toBe('/api/v1/auth/google/start')
  })

  it('keeps the error marker when the signed-out bounce moves / to /login', async () => {
    // Callbacks land on the app root, so the bounce to /login?return=… must
    // carry the marker along or the friendly message would be lost.
    window.history.replaceState({}, '', '/?error=google_unavailable')
    vi.stubGlobal('fetch', fixtureFetch(withConfig(true)))
    render(<App />)
    expect(await screen.findByText(/Google sign-in is not available right now/)).toBeTruthy()
    expect(window.location.search).toBe('')
  })

  it('renders a friendly message for each error marker and clears it from the URL', async () => {
    const messages = {
      google_invalid_handshake: 'Your Google sign-in session expired or was already used. Start again from the sign-in page.',
      google_email_unverified: 'Your Google account has no verified email address, so ClubSpace cannot link it. Verify the email with Google and try again.',
      google_sign_in_busy: 'Another sign-in just touched your account. Wait a moment and try again.',
      google_email_linked_elsewhere: 'This Google account is already linked to a different ClubSpace account. Sign in with that account’s password instead.',
      google_unavailable: 'Google sign-in is not available right now. Please try again shortly, or use your email and password.',
      google_not_a_marker: 'Google sign-in failed. Please try again, or use your email and password.',
    }
    for (const [marker, message] of Object.entries(messages)) {
      window.history.replaceState({}, '', `/login?error=${marker}`)
      vi.stubGlobal('fetch', fixtureFetch(withConfig(true)))
      const { unmount } = render(<App />)
      expect(await screen.findByText(message)).toBeTruthy()
      expect(window.location.search).toBe('')
      unmount()
      cleanup()
      vi.unstubAllGlobals()
    }
  })
})
