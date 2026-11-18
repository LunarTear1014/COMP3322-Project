// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.jsx'
import { setCsrf } from '../src/api.js'
import { fixtureFetch, json } from './support/fixtureFetch.js'

// Privacy policy and terms: public pages that Google's OAuth consent screen links to.
const signedOut = () => fixtureFetch(url => (url.pathname === '/api/v1/auth/session'
  ? json({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'Sign in.', fields: {} } }, 401) : null))

beforeEach(() => { setCsrf(null) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/') })

describe('privacy policy and terms', () => {
  it('serves /privacy without signing in and explains the Google data', async () => {
    window.history.replaceState({}, '', '/privacy')
    vi.stubGlobal('fetch', signedOut())
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Privacy policy', level: 1 })).toBeTruthy()
    expect(screen.getByText(/Google tells us your Google account ID/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'terms of use' }).getAttribute('href')).toBe('/terms')
    expect(screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href')).toBe('/login')
  })

  it('serves /terms without signing in', async () => {
    window.history.replaceState({}, '', '/terms')
    vi.stubGlobal('fetch', signedOut())
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Terms of use', level: 1 })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'privacy policy' }).getAttribute('href')).toBe('/privacy')
  })

  it('is linked from the sign-in footer and works when signed in', async () => {
    window.history.replaceState({}, '', '/login')
    vi.stubGlobal('fetch', signedOut())
    render(<App />)
    expect((await screen.findByRole('link', { name: 'Privacy' })).getAttribute('href')).toBe('/privacy')
    expect(screen.getByRole('link', { name: 'Terms' }).getAttribute('href')).toBe('/terms')
    cleanup()

    window.history.replaceState({}, '', '/credits')
    vi.stubGlobal('fetch', fixtureFetch())
    render(<App />)
    fireEvent.click(await screen.findByRole('link', { name: 'privacy policy' }))
    expect(await screen.findByRole('heading', { name: 'Privacy policy', level: 1 })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to Explore' })).toBeTruthy()
  })
})
