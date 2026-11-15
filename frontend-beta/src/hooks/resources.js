import { useCallback, useEffect, useState } from 'react'
import { request } from '../api'

export function useResource(path) {
  const [state, setState] = useState({ path: null, loading: true })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!path) return
    const controller = new AbortController()
    setState(previous => previous.path === path ? { ...previous, loading: true, error: null } : { path, loading: true })
    request(path, { signal: controller.signal })
      .then(result => setState({ ...result, path, loading: false }))
      .catch(error => { if (error.name !== 'AbortError') setState({ path, error, loading: false }) })
    return () => controller.abort()
  }, [path, tick])
  const refresh = useCallback(() => setTick(current => current + 1), [])
  const visible = state.path === path ? state : { loading: Boolean(path) }
  return { ...visible, refresh }
}
export function useAllOptions(path) {
  const [state, setState] = useState({ loading: true })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        setState(previous => ({ ...previous, loading: true, error: null }))
        const items = []
        let page = 1
        while (true) {
          const result = await request(`${path}?page=${page}&page_size=100`, { signal: controller.signal })
          items.push(...result.data)
          if (items.length >= result.meta.total) break
          if (!result.data.length || result.meta.page !== page) throw new Error('Could not load all filter options.')
          page += 1
        }
        setState({ data: items, loading: false })
      } catch (error) {
        if (error.name !== 'AbortError') setState({ error, loading: false })
      }
    }
    load()
    return () => controller.abort()
  }, [path, tick])
  const refresh = useCallback(() => setTick(current => current + 1), [])
  return { ...state, refresh }
}
export function useAction(refresh) { const [error, setError] = useState(null); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); async function run(path, method, body, success) { setBusy(true); setError(null); setMessage(''); try { const result = await request(path, { method, body }); setMessage(success || 'Saved.'); refresh?.(); return result } catch (e) { setError(e); if (e.status === 409 || e.status === 0 || e.code === 'INVALID_RESPONSE') refresh?.(); return null } finally { setBusy(false) } } return { run, error, busy, message } }
