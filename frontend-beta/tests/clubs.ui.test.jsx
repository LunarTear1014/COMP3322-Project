// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCsrf } from '../src/api.js'
import { fixtureFetch, json } from './support/fixtureFetch.js'

vi.mock('../src/lib/cover.js', async importOriginal => ({ ...(await importOriginal()), readImageSize: vi.fn(async () => ({ width: 1200, height: 800 })) }))
const { default: App } = await import('../src/App.jsx')
const { photoForm, photoProblem } = await import('../src/lib/clubPhoto.js')

beforeEach(() => setCsrf(null))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
})
URL.createObjectURL = () => 'blob:preview'
URL.revokeObjectURL = () => {}

const file = (name = 'club.jpg', type = 'image/jpeg', bytes = 1000) => new File([new Uint8Array(bytes)], name, { type })
const roleSession = role => ({
  user: { id: 1, name: 'Alex Chan', email: 'preview@clubspace.test', student_id: 'PREVIEW-01', platform_role: 'student' },
  memberships: [{ club_id: 1, club_name: 'Photography Society', role, version: 3, joined_at: '2026-01-01T00:00:00Z', club_icon: null, club_photo: null }],
  csrf_token: 'local-preview-token',
})
const asRole = role => url => (url.pathname === '/api/v1/auth/session' ? json({ data: roleSession(role) }) : null)

describe('club photo rules', () => {
  it('checks type, size and dimensions before upload', () => {
    expect(photoProblem(file(), { width: 600, height: 400 })).toBe('')
    expect(photoProblem(file('a.png', 'image/png'), { width: 1672, height: 941 })).toBe('')
    expect(photoProblem(file('a.gif', 'image/gif'), { width: 1200, height: 800 })).toMatch(/JPEG, PNG or WebP/)
    expect(photoProblem(file('a.jpg', 'image/jpeg', 5 * 1024 * 1024 + 1), { width: 1200, height: 800 })).toMatch(/5 MB/)
    expect(photoProblem(file(), { width: 500, height: 800 })).toBe('Club photos need at least 600×400 pixels.')
    expect(photoProblem(file(), null)).toMatch(/could not be read/)
  })

  it('builds the multipart body the API expects', () => {
    const form = photoForm({ file: file(), alt: '  Members at a table ' })
    expect(form.get('file').name).toBe('club.jpg')
    expect(form.get('alt')).toBe('Members at a table')
  })
})

describe('club photos', () => {
  it('shows each club\'s photo with its alt text in the directory, and the colour art when there is none', async () => {
    window.history.replaceState({}, '', '/clubs')
    vi.stubGlobal('fetch', fixtureFetch())
    render(<App />)

    const photo = await screen.findByAltText('Students gathered around a table of printed photographs')
    expect(photo.getAttribute('src')).toBe('/api/v1/clubs/1/photo/card?v=fixture')
    expect(photo.className).toContain('club-photo')
    const club3 = (await screen.findByRole('heading', { name: '攝影 Chess & Strategy' })).closest('article')
    expect(club3.querySelector('img.club-photo')).toBeNull()
    expect(club3.querySelector('.cs-cover-art')).toBeTruthy()
    expect(within(club3).getByText('攝')).toBeTruthy()
  })

  it('shows the photo on the organizer club card and lets an organizer open the editor and upload', async () => {
    window.history.replaceState({}, '', '/organizer/clubs')
    const fetch = fixtureFetch()
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    const card = (await screen.findByRole('heading', { name: 'Photography Society' })).closest('article')
    expect(within(card).getByAltText('Students gathered around a table of printed photographs')).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: 'Change the Photography Society photo' }))
    const editor = within(card).getByRole('group', { name: /Club photo/ })
    expect(within(editor).getByRole('button', { name: /Remove photo/ })).toBeTruthy()
    fireEvent.change(editor.querySelector('input[type=file]'), { target: { files: [file('team.jpg')] } })
    const alt = await within(editor).findByRole('textbox', { name: /Describe the image/ })
    fireEvent.change(alt, { target: { value: 'The committee on the steps' } })
    fireEvent.click(within(editor).getByRole('button', { name: 'Upload photo' }))
    await waitFor(() => {
      const put = fetch.mock.calls.find(([url, o]) => new URL(url, 'http://localhost').pathname === '/api/v1/clubs/1/photo' && o?.method === 'PUT')
      expect(put).toBeTruthy()
      expect(put[1].body.get('alt')).toBe('The committee on the steps')
      expect(put[1].body.get('file').name).toBe('team.jpg')
    })
    expect(await screen.findByText('Photography Society photo saved.')).toBeTruthy()
  })

  it('removes the photo from the editor', async () => {
    window.history.replaceState({}, '', '/organizer/clubs')
    const fetch = fixtureFetch()
    vi.stubGlobal('fetch', fetch)
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Change the Photography Society photo' }))
    fireEvent.click(screen.getByRole('button', { name: /Remove photo/ }))
    await waitFor(() => expect(fetch.mock.calls.some(([url, o]) => new URL(url, 'http://localhost').pathname === '/api/v1/clubs/1/photo' && o?.method === 'DELETE')).toBe(true))
    expect(await screen.findByText('Photography Society photo removed.')).toBeTruthy()
  })

  it('gives a venue administrator the photos but no editor', async () => {
    window.history.replaceState({}, '', '/clubs')
    vi.stubGlobal('fetch', fixtureFetch(undefined, { account: 'admin' }))
    render(<App />)

    expect(await screen.findByAltText('Students gathered around a table of printed photographs')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /photo/i })).toBeNull()
  })
})

describe('members table', () => {
  it('lists the president, then the committee, then members, with a joined date', async () => {
    window.history.replaceState({}, '', '/organizer/clubs/1/members')
    vi.stubGlobal('fetch', fixtureFetch(asRole('president')))
    render(<App />)

    const region = await screen.findByRole('region', { name: 'Club members' })
    const rows = within(region).getAllByRole('row').slice(1)
    const summary = rows.map(row => within(row).getAllByRole('cell').slice(0, 2).map(cell => cell.textContent))
    expect(rows.map(row => within(row).getByRole('rowheader').textContent.replace(' (you)', ''))).toEqual(['Morgan Lee', 'Alex Chan', 'Zara Wong', 'Ada Ng', 'Riley Chen'])
    expect(summary.map(([role]) => role)).toEqual(['President', 'Committee', 'Committee', 'Member', 'Member'])
    expect(within(rows[0]).getAllByRole('cell')[1].textContent).toBe('1 Sept 2025')
    expect(within(region).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Name', 'Role', 'Joined', 'Actions'])
    // Search keeps the order and filters rows.
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search members' }), { target: { value: 'a' } })
    expect(within(region).getAllByRole('row').length).toBeGreaterThan(1)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search members' }), { target: { value: 'zzz' } })
    expect(await screen.findByText('No members match “zzz”.')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Club members' })).toBeNull()
  })

  it('keeps each row\'s confirmation inside the table', async () => {
    window.history.replaceState({}, '', '/organizer/clubs/1/members')
    vi.stubGlobal('fetch', fixtureFetch(asRole('president')))
    render(<App />)

    const region = await screen.findByRole('region', { name: 'Club members' })
    fireEvent.click(within(region).getByRole('button', { name: 'Make Zara Wong president' }))
    const confirm = within(region).getByRole('group', { name: 'Transfer the presidency to Zara Wong' })
    expect(confirm.closest('td')).toBeTruthy()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(within(region).queryByRole('group')).toBeNull()
    expect(within(region).getByRole('button', { name: 'Make Zara Wong president' })).toBeTruthy()
  })
})

describe('activity log for the committee', () => {
  it('is readable by a committee member, with no Undo and a note about who can undo', async () => {
    window.history.replaceState({}, '', '/organizer/clubs/1/members')
    vi.stubGlobal('fetch', fixtureFetch(asRole('committee')))
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Club activity log' })).toBeTruthy()
    expect(await screen.findByText(/Appointed a member to the committee\./)).toBeTruthy()
    expect(screen.getByText('Only the president can undo actions.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull()
  })

  it('offers Undo to the president only where the API says the action is undoable', async () => {
    window.history.replaceState({}, '', '/organizer/clubs/1/members')
    vi.stubGlobal('fetch', fixtureFetch((url, options) => {
      if (url.pathname === '/api/v1/clubs/1/actions' && (!options.method || options.method === 'GET')) {
        return json({ data: [{ id: 5, type: 'member_removed', description: 'Removed a regular member from the club.', actor: { id: 2, name: 'Morgan Lee' }, target: { id: 3, name: 'Riley Chen' }, undoable: true, created_at: new Date().toISOString(), undone_at: null }], meta: { page: 1, page_size: 20, total: 1 } })
      }
      return asRole('president')(url)
    }))
    render(<App />)

    expect(await screen.findByRole('button', { name: 'Undo: Removed a regular member from the club.' })).toBeTruthy()
    expect(screen.queryByText('Only the president can undo actions.')).toBeNull()
  })

  it('is linked from each club on the organizer club page and the organizer home', async () => {
    window.history.replaceState({}, '', '/organizer/clubs')
    vi.stubGlobal('fetch', fixtureFetch())
    render(<App />)

    const card = (await screen.findByRole('heading', { name: 'Photography Society' })).closest('article')
    expect(within(card).getByRole('link', { name: 'Activity log' }).getAttribute('href')).toBe('/organizer/clubs/1/members#action-log-title')
    cleanup()

    window.history.replaceState({}, '', '/organizer')
    vi.stubGlobal('fetch', fixtureFetch())
    render(<App />)
    expect((await screen.findByRole('link', { name: 'Photography Society activity log' })).getAttribute('href')).toBe('/organizer/clubs/1/members#action-log-title')
  })
})
