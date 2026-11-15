import { Check, CircleAlert, Bell } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

// One polite live region mounted once per app. A toast shows one sentence and
// at most one action. It stays 5 seconds, pauses while hovered or focused, and
// calls `onExpire` if it ends without the action being used (so "Undo" flows
// can send their request only after the window closes).
const ToastContext = createContext({ show: () => {}, dismiss: () => {} })
export const useToast = () => useContext(ToastContext)

const DURATION_MS = 5000
const TONE_ICON = { success: Check, error: CircleAlert, info: Bell }

export function ToastProvider({ children, duration = DURATION_MS }) {
  const [toast, setToast] = useState(null)
  const timer = useRef(null)
  const remaining = useRef(0)
  const started = useRef(0)
  const current = useRef(null)

  const clear = useCallback(() => { clearTimeout(timer.current); timer.current = null }, [])

  const finish = useCallback(expired => {
    clear()
    const active = current.current
    current.current = null
    setToast(null)
    if (expired && active?.onExpire) active.onExpire()
  }, [clear])

  const start = useCallback(ms => {
    clear()
    remaining.current = ms
    started.current = Date.now()
    timer.current = setTimeout(() => finish(true), ms)
  }, [clear, finish])

  const show = useCallback(({ message, tone = 'success', action, onExpire, durationMs = duration }) => {
    // A new toast replaces the old one; an unfinished Undo window ends first.
    if (current.current?.onExpire) current.current.onExpire()
    const next = { id: Date.now() + Math.random(), message, tone, action, onExpire }
    current.current = next
    setToast(next)
    start(durationMs)
  }, [duration, start])

  const pause = useCallback(() => {
    if (!timer.current) return
    clear()
    remaining.current = Math.max(1000, remaining.current - (Date.now() - started.current))
  }, [clear])
  const resume = useCallback(() => { if (current.current && !timer.current) start(remaining.current) }, [start])

  useEffect(() => clear, [clear])

  const value = useMemo(() => ({ show, dismiss: () => finish(false) }), [show, finish])
  const Icon = toast ? TONE_ICON[toast.tone] || Check : null
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="cs-toast-region" role="status" aria-live="polite">
        {toast && (
          <div
            key={toast.id}
            className={`cs-toast${toast.tone === 'success' ? ' cs-toast-success' : toast.tone === 'error' ? ' cs-toast-error' : ''}`}
            onMouseEnter={pause}
            onMouseLeave={resume}
            onFocus={pause}
            onBlur={resume}
          >
            <span className="cs-toast-dot" style={toast.tone === 'info' ? { background: 'var(--sun)' } : undefined}>
              <Icon className="cs-icon" aria-hidden="true" />
            </span>
            <span>{toast.message}</span>
            {toast.action && (
              <button type="button" onClick={() => { const { onClick } = toast.action; current.current = null; clear(); setToast(null); onClick?.() }}>
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  )
}
