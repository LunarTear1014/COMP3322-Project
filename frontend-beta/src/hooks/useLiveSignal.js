import { useEffect, useRef } from 'react'

// Live change hints from the notification stream (useLiveInbox re-dispatches
// each `signal` event on window). A hint is `{ topic, event_id }` only; pages
// refetch through their normal routes, so nothing private travels in it.
export const SIGNAL_EVENT = 'clubspace:signal'

export function dispatchSignal(hint) {
  window.dispatchEvent(new CustomEvent(SIGNAL_EVENT, { detail: hint }))
}

// Calls `onSignal` when a matching hint arrives. Bursts (a queue of
// promotions, a crowd checking in) collapse into one call per `wait` ms, and
// a hidden tab catches up once when it becomes visible again.
export function useLiveSignal(matches, onSignal, { wait = 700 } = {}) {
  const latest = useRef({ matches, onSignal })
  latest.current = { matches, onSignal }

  useEffect(() => {
    let timer = null
    let pending = false
    const fire = () => {
      timer = null
      if (document.hidden) { pending = true; return }
      pending = false
      latest.current.onSignal()
    }
    const onHint = event => {
      if (!latest.current.matches(event.detail)) return
      if (!timer) timer = setTimeout(fire, wait)
    }
    const onVisible = () => { if (!document.hidden && pending) fire() }
    window.addEventListener(SIGNAL_EVENT, onHint)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      window.removeEventListener(SIGNAL_EVENT, onHint)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [wait])
}

// Common matchers.
export const eventChanged = id => hint => hint?.topic === 'event' && hint.event_id === Number(id)
export const anyEventIn = ids => hint => hint?.topic === 'event' && ids.has(hint.event_id)
export const attendanceChanged = id => hint => hint?.topic === 'attendance' && hint.event_id === Number(id)

// Each live notification is also re-dispatched on window, so open pages can
// refetch when it concerns them (My events on a registration change, Members
// and roles on a role change in another session: F08, F11).
export const NOTIFICATION_EVENT = 'clubspace:notification'

export function dispatchNotification(notification) {
  window.dispatchEvent(new CustomEvent(NOTIFICATION_EVENT, { detail: notification }))
}

export function useNotificationSignal(matches, onNotification) {
  const latest = useRef({ matches, onNotification })
  latest.current = { matches, onNotification }
  useEffect(() => {
    const handle = event => { if (latest.current.matches(event.detail)) latest.current.onNotification(event.detail) }
    window.addEventListener(NOTIFICATION_EVENT, handle)
    return () => window.removeEventListener(NOTIFICATION_EVENT, handle)
  }, [])
}
