import { X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// A modal panel: rises from the bottom on phones, centred on desktop. Focus
// moves in, is trapped, and returns to the opener; Escape, the close button and
// the scrim all close it. The primary footer action states its result
// ("Show 12 events"), not "Apply".
export function BottomSheet({ open, title, onClose, children, footer }) {
  const titleId = useId()
  const sheet = useRef(null)
  const opener = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    opener.current = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const first = sheet.current?.querySelector(FOCUSABLE)
    first?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      if (opener.current instanceof HTMLElement) opener.current.focus()
    }
  }, [open])

  if (!open) return null

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const items = [...sheet.current.querySelectorAll(FOCUSABLE)]
    if (!items.length) return
    const [first, last] = [items[0], items[items.length - 1]]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  return (
    <div className="cs-sheet-root" onKeyDown={onKeyDown}>
      <div className="cs-scrim" aria-hidden="true" onClick={onClose} />
      <div className="cs-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={sheet}>
        <span className="cs-grabber" aria-hidden="true" />
        <div className="cs-sheet-head">
          <h3 id={titleId}>{title}</h3>
          <button className="cs-iconbtn" type="button" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>
            <X className="cs-icon" aria-hidden="true" />
          </button>
        </div>
        <div className="cs-sheet-body">{children}</div>
        {footer && <div className="cs-sheet-foot">{footer}</div>}
      </div>
    </div>
  )
}
