import assert from 'node:assert/strict'
import { test } from 'node:test'
import { request, setCsrf } from '../src/api.js'

test('multipart bodies are sent as FormData without a JSON content type, with the CSRF token', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push([url, options])
    return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 })
  }
  setCsrf('token-1')
  const form = new FormData()
  form.set('alt', 'A hall')
  await request('/events/5/cover', { method: 'PUT', body: form })
  const [url, options] = calls[0]
  assert.equal(url, '/api/v1/events/5/cover')
  assert.ok(options.body instanceof FormData)
  assert.equal(options.headers['Content-Type'], undefined)
  assert.equal(options.headers['X-CSRF-Token'], 'token-1')
  await request('/events/5/cover', { method: 'DELETE', body: { expected_version: 2 } })
  assert.equal(calls[1][1].headers['Content-Type'], 'application/json')
  assert.equal(calls[1][1].body, '{"expected_version":2}')
})
