import { Readable } from 'node:stream'
import { vi } from 'vitest'
import { fixturePlugin } from '../../dev/fixtures.js'

let handler
// A fresh plugin also resets the preview's in-memory removal requests.
export function resetFixtures() { fixturePlugin().configureServer({ middlewares: { use(_path, callback) { handler = callback } } }) }
resetFixtures()

// A fetch stub backed by the local preview fixtures. `override(url, options)`
// may return a Response to replace a fixture answer; `log` records every call.
// `account: 'admin'` signs in as the venue administrator instead of the student organizer.
export function fixtureFetch(override, { account = 'student' } = {}) {
  return vi.fn((input, options = {}) => new Promise(resolve => {
    const url = new URL(input, 'http://localhost')
    const replaced = override?.(url, options)
    if (replaced) { resolve(replaced); return }
    const body = options.body || ''
    const request = Readable.from(body ? [body] : [])
    request.url = `${url.pathname.replace('/api/v1', '')}${url.search}`
    request.method = options.method || 'GET'
    request.headers = { cookie: account === 'admin' ? 'clubspace_preview=admin' : 'clubspace_preview=1' }
    const headers = new Headers()
    handler(request, {
      statusCode: 200,
      setHeader(name, value) { headers.set(name, value) },
      end(payload) {
        resolve({
          status: this.statusCode,
          ok: this.statusCode >= 200 && this.statusCode < 300,
          headers,
          json: async () => JSON.parse(payload),
        })
      },
    })
  }))
}

export const json = (data, status = 200) => new Response(JSON.stringify(data), { status })
