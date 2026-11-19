// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.jsx'
import { setCsrf } from '../src/api.js'
import { fixtureFetch } from './support/fixtureFetch.js'

beforeEach(() => setCsrf(null))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
})

describe('shortcuts to who joined or quit', () => {
  it('the club committee sees "See who\'s joining" on its own event page', async () => {
    window.history.replaceState({}, '', '/events/1')
    vi.stubGlobal('fetch', fixtureFetch())
    render(<App />)
    const link = await screen.findByRole('link', { name: /See who's joining/ })
    expect(link.getAttribute('href')).toBe('/organizer/events/1?tab=people')
  })

  it('is not shown on another club\'s event or to a venue admin', async () => {
    window.history.replaceState({}, '', '/events/6')
    vi.stubGlobal('fetch', fixtureFetch())
    render(<App />)
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('link', { name: /See who's joining/ })).toBeNull()
    cleanup()

    window.history.replaceState({}, '', '/events/1')
    vi.stubGlobal('fetch', fixtureFetch(null, { account: 'admin' }))
    render(<App />)
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('link', { name: /See who's joining/ })).toBeNull()
  })

  // The figures are a lazy chunk with MUI X charts; load it first (see workflows.ui.test.jsx).
  it('each event in the activity report links to its People tab', async () => {
    await import('../src/ReportFigures.jsx')
    window.history.replaceState({}, '', '/organizer/clubs/1/reports')
    vi.stubGlobal('fetch', fixtureFetch())
    render(<App />)
    const heading = await screen.findByRole('heading', { name: 'Current participant counts' })
    const links = await within(heading.closest('section')).findAllByRole('link', { name: /^See who joined or quit / })
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) expect(link.getAttribute('href')).toMatch(/^\/organizer\/events\/\d+\?tab=people$/)
  }, 30_000)
})
