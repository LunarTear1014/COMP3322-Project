import { useEffect } from 'react'

// The event page's primary action on phones, fixed above the tab bar. The info
// block is a polite live region, so a change ("You’re #3 on the waitlist") is
// announced. It reserves its height so focused fields are never hidden under it.
export function StickyActionBar({ info, children }) {
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--actionbar-height', '76px')
    return () => root.style.removeProperty('--actionbar-height')
  }, [])
  return (
    <div className="cs-actionbar sticky-action-bar">
      <div className="cs-actionbar-info" aria-live="polite">{info}</div>
      {children}
    </div>
  )
}
