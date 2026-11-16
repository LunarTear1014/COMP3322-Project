import { useEffect, useRef } from 'react'

export const STREAM_URL = '/api/v1/notifications/stream'
export const FALLBACK_POLL_MS = 60000

// Live inbox: one Server-Sent Events stream while signed in. The browser sends
// Last-Event-ID itself when it reconnects, so nothing is missed or repeated.
// Each `notification` event carries the unread count and the notification
// (badge and toast); `refetch` means the gap was too large to replay. If the
// stream is unavailable or breaks, the inbox is polled every 60 s instead, and
// polling stops again once the stream is back. The tab regaining focus always
// refetches. `streamFactory` is injectable for tests.
export function useLiveInbox({ enabled, refreshInbox, onUnread, onNotification, streamFactory }) {
  const handlers = useRef({})
  handlers.current = { refreshInbox, onUnread, onNotification }

  useEffect(() => {
    if (!enabled) return undefined
    const make = streamFactory || (typeof EventSource === 'undefined' ? null : url => new EventSource(url, { withCredentials: true }))
    let poll = null
    let stream = null
    const startPolling = () => {
      if (poll) return
      handlers.current.refreshInbox()
      poll = setInterval(() => handlers.current.refreshInbox(), FALLBACK_POLL_MS)
    }
    const stopPolling = () => { clearInterval(poll); poll = null }

    if (make) {
      stream = make(STREAM_URL)
      stream.addEventListener('open', stopPolling)
      stream.addEventListener('notification', event => {
        try {
          const { notification, unread_count: unread } = JSON.parse(event.data)
          handlers.current.onUnread(unread)
          handlers.current.onNotification?.(notification)
        } catch {
          handlers.current.refreshInbox()
        }
      })
      stream.addEventListener('refetch', () => handlers.current.refreshInbox())
      stream.addEventListener('error', startPolling)
      handlers.current.refreshInbox()
    } else {
      startPolling()
    }

    const onFocus = () => { if (!document.hidden) handlers.current.refreshInbox() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      stopPolling()
      stream?.close()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [enabled, streamFactory])
}
