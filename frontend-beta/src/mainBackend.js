import { ApiError } from './apiShared.js'

let csrfToken = null
let csrfLoading = null

async function getCsrf() {
  if (csrfToken) return csrfToken
  if (!csrfLoading) csrfLoading = call('/v1/auth/csrf').then(result => { csrfToken = result.data.csrf_token; return csrfToken }).finally(() => { csrfLoading = null })
  return csrfLoading
}

async function call(path, signal, method = 'GET', body) {
  let response
  const mutation = !['GET', 'HEAD'].includes(method)
  const token = mutation ? await getCsrf() : null
  try {
    response = await fetch(`/api${path}`, {
      signal, method, credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(mutation ? { 'Content-Type': 'application/json', 'X-CSRF-Token': token } : {}) },
      ...(mutation ? { body: JSON.stringify(body ?? {}) } : {}),
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new ApiError('Unable to reach the server. Refresh before retrying a change.', 0, 'NETWORK_ERROR')
  }
  if (response.status === 204) { if (path === '/v1/auth/logout') csrfToken = null; return { data: null } }
  const result = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = result?.error || result
    if (detail?.code === 'CSRF_INVALID' || response.status === 401) csrfToken = null
    throw new ApiError(detail?.message || `Request failed (${response.status}).`, response.status, detail?.code, detail?.fields || {}, response.headers.get('Retry-After'))
  }
  if (path === '/v1/auth/login' || path === '/v1/auth/session') csrfToken = result?.data?.csrf_token ?? null
  if (result == null) throw new ApiError('The server returned an invalid response.', response.status, 'INVALID_RESPONSE')
  return result
}

export async function requestMainBackend(path, { method = 'GET', body, signal } = {}) {
  const { pathname, searchParams } = new URL(path, 'http://clubspace.local')
  const get = path => call(path, signal)
  const send = (path, payload, verb = method) => call(path, signal, verb, payload)
  const eventMatch = pathname.match(/^\/events\/(\d+)(?:\/(registration|participants|cancel|publish))?$/)
  const clubMatch = pathname.match(/^\/clubs\/(\d+)\/membership$/)
  const calendarMatch = pathname.match(/^\/venues\/(\d+)\/calendar$/)
  const reportMatch = pathname.match(/^\/clubs\/(\d+)\/reports$/)
  const clubRequestMatch = pathname.match(/^\/clubs\/\d+\/join-requests(?:\/\d+\/decision)?$/)
  const eventRequestMatch = pathname.match(/^\/events\/\d+\/join-requests(?:\/\d+\/decision)?$/)

  if (pathname === '/auth/session') return get('/v1/auth/session')
  if (pathname === '/auth/login' || pathname === '/auth/register' || pathname === '/auth/logout') return send(`/v1${pathname}`, body)
  if (pathname === '/profile') return method === 'GET' ? get('/v1/profile') : send('/v1/profile', body)
  if (pathname === '/clubs' || pathname === '/me/memberships') return get(`/v1${pathname}?${searchParams}`)
  if (clubMatch) return send(`/v1${pathname}`, body)
  if (clubRequestMatch) return method === 'GET' ? get(`/v1${pathname}`) : send(`/v1${pathname}`, body)
  if (eventRequestMatch) return method === 'GET' ? get(`/v1${pathname}?${searchParams}`) : send(`/v1${pathname}`, body)
  if (reportMatch && method === 'GET') return get(`/v1${pathname}?${searchParams}`)
  if (pathname === '/events' && method === 'POST') return send('/v1/events', body)
  if ((pathname === '/events' || pathname === '/me/events' || pathname === '/me/registrations') && method === 'GET') return get(`/v1${pathname}?${searchParams}`)
  if (eventMatch) {
    const target = `/v1${pathname}${searchParams.size ? `?${searchParams}` : ''}`
    return method === 'GET' ? get(target) : send(target, body)
  }
  if ((pathname === '/bookings' && method === 'GET') || /^\/bookings\/\d+\/decision$/.test(pathname)) {
    const target = `/v1${pathname}${searchParams.size ? `?${searchParams}` : ''}`
    return method === 'GET' ? get(target) : send(target, body)
  }
  if (pathname === '/config') return get('/v1/config')
  if (pathname === '/venues' || calendarMatch) return get(`/v1${pathname}?${searchParams}`)
  if (pathname === '/notifications') {
    return get(`/v1${pathname}?${searchParams}`)
  }
  if (/^\/notifications\/\d+\/read$/.test(pathname)) return send(`/v1${pathname}`, body)
  throw new ApiError('This workflow requires the ClubSpace v1 provider.', 501, 'WORKFLOW_UNAVAILABLE')
}
