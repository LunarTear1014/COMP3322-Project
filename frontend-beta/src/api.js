import { ApiError } from './apiShared.js'
import { requestMainBackend } from './mainBackend.js'
export * from './apiShared.js'

export const usesMainBackend = ['development', 'production'].includes(import.meta.env?.MODE)

let csrfToken = null
export function setCsrf(token) { csrfToken = token }
export async function request(path, { method = 'GET', body, signal } = {}) {
  if (usesMainBackend) {
    try {
      return await requestMainBackend(path, { method, body, signal })
    } catch (error) {
      if (error.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('clubspace:unauthorized'))
      throw error
    }
  }
  const headers = { Accept: 'application/json' }
  if (method !== 'GET') {
    if (!csrfToken) { const result = await request('/auth/csrf'); csrfToken = result.data.csrf_token }
    headers['Content-Type'] = 'application/json'
    headers['X-CSRF-Token'] = csrfToken
  }
  let requestPath = path
  if (import.meta.env?.MODE === 'fixtures' && typeof window !== 'undefined') {
    const scenario = new URLSearchParams(window.location.search).get('preview')
    if (scenario === 'empty' || scenario === 'error' || scenario === 'student') {
      requestPath += `${requestPath.includes('?') ? '&' : '?'}preview=${scenario}`
    }
  }
  let response
  try { response = await fetch(`/api/v1${requestPath}`, { method, credentials: 'same-origin', headers, signal, ...(method !== 'GET' ? { body: JSON.stringify(body ?? {}) } : {}) }) }
  catch (error) { if (error.name === 'AbortError') throw error; throw new ApiError('Unable to reach the server. The outcome may be unknown; refresh before trying again.', 0, 'NETWORK_ERROR') }
  if (response.status === 204) return { data: null }
  let result
  try { result = await response.json() } catch { throw new ApiError('The server returned an invalid response.', response.status, 'INVALID_RESPONSE') }
  if (response.status === 401 && path !== '/auth/login' && path !== '/auth/session') window.dispatchEvent(new Event('clubspace:unauthorized'))
  if (!response.ok) throw new ApiError(result.error?.message || `Request failed (${response.status}).`, response.status, result.error?.code, result.error?.fields, response.headers.get('Retry-After'))
  if (!Object.hasOwn(result, 'data')) throw new ApiError('The server returned an invalid response.', response.status, 'INVALID_RESPONSE')
  return result
}
