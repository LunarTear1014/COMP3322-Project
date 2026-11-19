// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.jsx'
import { setCsrf } from '../src/api.js'
import { fixtureFetch, resetFixtures } from './support/fixtureFetch.js'

// A committee member's removal request needs the president's sign-off. The
// preview keeps one pending request (Zara Wong asked to remove Riley Chen).
beforeEach(() => { setCsrf(null); resetFixtures() })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/') })

// The app adds ?preview=<scenario> to every request only in fixtures mode; tests add it here.
const scenario = (name, override) => { const inner = fixtureFetch(override); return vi.fn((input, options) => inner(`${input}${String(input).includes('?') ? '&' : '?'}preview=${name}`, options)) }
const open = (path, fetch = fixtureFetch()) => {
  window.history.replaceState({}, '', path)
  vi.stubGlobal('fetch', fetch)
  render(<App />)
  return fetch
}
const calls = (fetch, path, method) => fetch.mock.calls.filter(([url, o]) => new URL(url, 'http://localhost').pathname === `/api/v1${path}` && (o?.method || 'GET') === method)
const row = async name => (await screen.findByRole('rowheader', { name: new RegExp(name) })).closest('tr')

describe('removal requests', () => {
  it('shows a committee member Request removal, never Remove, and the pending chip', async () => {
    const fetch = open('/organizer/clubs/1/members')
    const riley = await row('Riley Chen')
    expect(within(riley).getByText('Removal pending')).toBeTruthy()
    expect(within(riley).queryByRole('button', { name: /Withdraw/ })).toBeNull()
    expect(within(riley).queryByRole('button', { name: /Approve|Reject/ })).toBeNull()
    const ada = await row('Ada Ng')
    expect(screen.queryByRole('button', { name: /^Remove .* from the club$/ })).toBeNull()

    fireEvent.click(within(ada).getByRole('button', { name: 'Request removal of Ada Ng' }))
    const form = screen.getByRole('form', { name: 'Ask the president to remove Ada Ng' })
    expect(within(form).getByText(/president approves/)).toBeTruthy()
    fireEvent.change(within(form).getByRole('textbox', { name: /Reason/ }), { target: { value: ' Missed every meeting ' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Send request' }))
    await waitFor(() => expect(calls(fetch, '/clubs/1/members/6', 'DELETE')).toHaveLength(1))
    expect(JSON.parse(calls(fetch, '/clubs/1/members/6', 'DELETE')[0][1].body)).toEqual({ reason: 'Missed every meeting' })

    // The requester can withdraw their own request.
    const pending = await row('Ada Ng')
    expect(await within(pending).findByText('Removal pending')).toBeTruthy()
    fireEvent.click(within(pending).getByRole('button', { name: 'Withdraw the removal request for Ada Ng' }))
    await waitFor(() => expect(calls(fetch, '/clubs/1/removal-requests/502', 'DELETE')).toHaveLength(1))
    await waitFor(() => expect(within(screen.getByText('Ada Ng').closest('tr')).queryByText('Removal pending')).toBeNull())
  })

  it('gives the president Approve and Reject on the table, and Reject needs a reason', async () => {
    const fetch = open('/organizer/clubs/1/members', scenario('president'))
    const riley = await row('Riley Chen')
    expect(within(riley).getByText(/Asked by Zara Wong/)).toBeTruthy()
    expect(within(riley).getByRole('button', { name: 'Remove Riley Chen from the club' })).toBeTruthy()
    fireEvent.click(within(riley).getByRole('button', { name: 'Reject removing Riley Chen' }))
    const send = within(riley).getByRole('button', { name: 'Send rejection' })
    expect(send.disabled).toBe(true)
    fireEvent.change(within(riley).getByRole('textbox', { name: /Why not remove Riley Chen/ }), { target: { value: 'Give them another term.' } })
    expect(send.disabled).toBe(false)
    fireEvent.click(send)
    await waitFor(() => expect(calls(fetch, '/clubs/1/removal-requests/501/decision', 'POST')).toHaveLength(1))
    expect(JSON.parse(calls(fetch, '/clubs/1/removal-requests/501/decision', 'POST')[0][1].body)).toEqual({ decision: 'reject', reason: 'Give them another term.', expected_version: 1 })
    await waitFor(() => expect(within(screen.getByText('Riley Chen').closest('tr')).queryByText('Removal pending')).toBeNull())
  })

  it('lists pending requests in the Organizer sign-off queue, where the president can approve', async () => {
    const fetch = open('/organizer', scenario('president'))
    expect(await screen.findByRole('heading', { name: /Member removals waiting for your sign-off/ })).toBeTruthy()
    const item = (await screen.findByRole('heading', { name: 'Remove Riley Chen' })).closest('li')
    expect(within(item).getByText(/Zara Wong asked/)).toBeTruthy()
    expect(within(item).getByText(/Has not attended any event this term/)).toBeTruthy()
    fireEvent.click(within(item).getByRole('button', { name: 'Approve removing Riley Chen' }))
    await waitFor(() => expect(calls(fetch, '/clubs/1/removal-requests/501/decision', 'POST')).toHaveLength(1))
    expect(JSON.parse(calls(fetch, '/clubs/1/removal-requests/501/decision', 'POST')[0][1].body)).toEqual({ decision: 'approve', expected_version: 1 })
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Remove Riley Chen' })).toBeNull())
  })

  it('does not show the queue to a committee member', async () => {
    open('/organizer')
    expect(await screen.findByRole('heading', { name: 'Organizer' })).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('heading', { name: /Member removals waiting/ })).toBeNull())
  })

  it('puts Approve and Reject on the president’s inbox item, and Reject needs a reason', async () => {
    const fetch = open('/notifications', scenario('president'))
    const item = (await screen.findByRole('heading', { name: /Removal request: Photography Society/ })).closest('li')
    expect(within(item).getByText('Zara Wong asked to remove Riley Chen.')).toBeTruthy()
    fireEvent.click(within(item).getByRole('button', { name: 'Reject removing Riley Chen' }))
    expect(within(item).getByRole('button', { name: 'Send rejection' }).disabled).toBe(true)
    fireEvent.change(within(item).getByRole('textbox', { name: /Why not remove/ }), { target: { value: 'Not this term.' } })
    fireEvent.click(within(item).getByRole('button', { name: 'Send rejection' }))
    await waitFor(() => expect(calls(fetch, '/clubs/1/removal-requests/501/decision', 'POST')).toHaveLength(1))
    expect(JSON.parse(calls(fetch, '/clubs/1/removal-requests/501/decision', 'POST')[0][1].body)).toEqual({ decision: 'reject', reason: 'Not this term.', expected_version: 1 })
  })

  it('shows a decision notification plainly, without buttons', async () => {
    open('/notifications', fixtureFetch(url => (url.pathname === '/api/v1/notifications' ? new Response(JSON.stringify({ data: [{
      id: 9, type: 'member_removal_decided', club_id: 1, join_request_id: null, removal_request_id: null, title: 'Removal not approved: Photography Society',
      body: 'Morgan Lee did not approve removing Riley Chen. Reason: Not this term.', created_at: new Date().toISOString(), read_at: null,
    }], meta: { page: 1, page_size: 20, total: 1, unread_count: 1 } }), { status: 200 }) : null)))
    const item = (await screen.findByRole('heading', { name: /Removal not approved/ })).closest('li')
    expect(within(item).getByText(/Reason: Not this term/)).toBeTruthy()
    expect(within(item).getByText('Removal decision')).toBeTruthy()
    expect(within(item).queryByRole('button', { name: /Approve|Reject/ })).toBeNull()
  })

  it('keeps the venue admin out of club removal requests', async () => {
    open('/notifications', fixtureFetch(null, { account: 'admin' }))
    await screen.findByRole('heading', { name: 'Inbox' })
    expect(screen.queryByRole('button', { name: /Approve removing|Request removal/ })).toBeNull()
  })
})
