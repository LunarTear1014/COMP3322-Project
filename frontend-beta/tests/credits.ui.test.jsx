// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.jsx'
import { setCsrf } from '../src/api.js'
import { fixtureFetch, json } from './support/fixtureFetch.js'

// The credits page required by the project guideline (section 8).
beforeEach(() => { setCsrf(null) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/') })

describe('credits', () => {
  it('is public and lists libraries, fonts and licences', async () => {
    window.history.replaceState({}, '', '/credits')
    vi.stubGlobal('fetch', fixtureFetch(url => (url.pathname === '/api/v1/auth/session'
      ? json({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'Sign in.', fields: {} } }, 401) : null)))
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Credits', level: 1 })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'MUI X Charts' }).getAttribute('href')).toBe('https://mui.com/x/react-charts/')
    expect(screen.getByRole('link', { name: 'Lucide' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Bricolage Grotesque' })).toBeTruthy()
    expect(screen.getAllByText(/SIL Open Font License/).length).toBe(2)
    expect(screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href')).toBe('/login')
  })

  it('is linked from the sign-in footer and the account menu', async () => {
    window.history.replaceState({}, '', '/login')
    vi.stubGlobal('fetch', fixtureFetch(url => (url.pathname === '/api/v1/auth/session'
      ? json({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'Sign in.', fields: {} } }, 401) : null)))
    render(<App />)
    expect((await screen.findByRole('link', { name: 'Credits' })).getAttribute('href')).toBe('/credits')
    cleanup()

    window.history.replaceState({}, '', '/events')
    vi.stubGlobal('fetch', fixtureFetch())
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Account/ }))
    fireEvent.click(screen.getByRole('link', { name: 'Credits' }))
    expect(await screen.findByRole('heading', { name: 'Credits', level: 1 })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to Explore' })).toBeTruthy()
  })
})
