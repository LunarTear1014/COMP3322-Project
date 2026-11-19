// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.jsx'
import { setCsrf } from '../src/api.js'
import { fixtureFetch, json } from './support/fixtureFetch.js'

beforeEach(() => setCsrf(null))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/') })

const open = async override => {
  window.history.replaceState({}, '', '/organizer/events/1?tab=people')
  const fetch = fixtureFetch(override)
  vi.stubGlobal('fetch', fetch)
  render(<App />)
  return fetch
}

describe('organizer people tab', () => {
  it('participants table shows club role, plain status words and the quit time', async () => {
    await open()
    const region = await screen.findByRole('region', { name: 'Participants' })
    const table = within(region).getByRole('table')
    expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Name', 'Club', 'Email', 'Student ID', 'Status', 'Registered', 'Quit', 'Checked in'])
    const row = (await within(table).findByText('Morgan Lee')).closest('tr')
    expect(within(row).getByText('President')).toBeTruthy()
    expect(within(row).getByText('Joined')).toBeTruthy()
    expect(within(table).getByText('Jess Ho').closest('tr').textContent).toContain('Non-member')
    expect(within(table).getByText('Ada Ng').closest('tr').textContent).toContain('Member')

    fireEvent.change(screen.getByLabelText('Filter'), { target: { value: 'left' } })
    const sam = (await screen.findByText('Sam Lee', { selector: 'td' })).closest('tr')
    expect(within(sam).getByText('Quit')).toBeTruthy()
    expect(within(sam).getAllByRole('cell')[6].textContent).not.toBe('—')
    expect(screen.getByRole('option', { name: 'Cancelled by event' })).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Filter'), { target: { value: 'waitlisted' } })
    expect(await screen.findByRole('columnheader', { name: 'Queue position' })).toBeTruthy()
  })

  it('join and quit activity lists newest first with a summary', async () => {
    await open()
    const list = await screen.findByRole('list', { name: 'Join and quit activity' })
    const items = within(list).getAllByRole('listitem')
    expect(items.length).toBe(10)
    expect(items[0].textContent).toContain('Noah Kim')
    expect(items[0].textContent).toContain('rejoined')
    expect(items[1].textContent).toContain('promoted from the waitlist')
    expect(items[2].textContent).toContain('Sam Lee')
    expect(items[2].textContent).toContain('quit')
    expect(screen.getByLabelText('Summary').textContent).toBe('9 joined · 3 quit · 1 rejoined · 1 promoted from the waitlist')
    expect(screen.getByRole('navigation', { name: 'Pages' })).toBeTruthy()
  })

  it('credits the organizer who accepted someone', async () => {
    await open()
    const ada = (await screen.findByText('Ada Ng', { selector: 'strong' })).closest('li')
    expect(ada.textContent).toContain('(by Zara Wong)')
  })

  it('filtering to Quit shows only quits and keeps the whole-event summary', async () => {
    const fetch = await open()
    await screen.findByRole('list', { name: 'Join and quit activity' })
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'left' } })
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Join and quit activity' })).getAllByRole('listitem').length).toBe(3))
    const items = within(screen.getByRole('list', { name: 'Join and quit activity' })).getAllByRole('listitem')
    expect(items.every(item => item.textContent.includes('quit'))).toBe(true)
    expect(fetch.mock.calls.some(([u]) => /participation-history\?action=left/.test(String(u)))).toBe(true)
    expect(screen.getByLabelText('Summary').textContent).toContain('9 joined')
  })

  it('shows an empty state when nobody has joined or quit', async () => {
    await open(url => (url.pathname === '/api/v1/events/1/participation-history'
      ? json({ data: [], summary: { joined_people: 0, quit_people: 0, rejoined_people: 0, promoted: 0, currently_joined: 0, currently_waitlisted: 0 }, meta: { page: 1, page_size: 10, total: 0 } })
      : null))
    expect(await screen.findByText('No one has joined or quit yet.')).toBeTruthy()
    expect(screen.getByLabelText('Summary').textContent).toBe('0 joined · 0 quit')
  })
})
