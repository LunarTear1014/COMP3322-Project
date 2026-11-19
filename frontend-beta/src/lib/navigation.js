// The internal page a sign-in should return to: only same-site paths, never
// "//host" or absolute URLs.
export function safeReturn(search) {
  const target = new URLSearchParams(search).get('return')
  return target?.startsWith('/') && !target.startsWith('//') && !target.startsWith('/\\') && target !== '/login' && target !== '/register' ? target : '/events'
}
