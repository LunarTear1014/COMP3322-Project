import { CalendarDays, ChevronDown, Info, LogOut, ShieldCheck, UserRound, Users } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { isOrganizer } from '../../lib/roles'

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => [...part][0].toUpperCase()).join('') || '?'
}

// The avatar control: Profile, then role tools the user may use, Credits, then Sign out.
// A disclosure, not an ARIA menu: Tab moves through the links, Escape or a click
// elsewhere closes it, and focus returns to the trigger.
export function AccountMenu({ session, onSignOut }) {
  const [open, setOpen] = useState(false)
  const root = useRef(null)
  const trigger = useRef(null)
  const panelId = useId()
  const organizer = session.memberships.some(isOrganizer)
  const admin = session.user.platform_role === 'venue_admin'

  useEffect(() => {
    if (!open) return undefined
    const away = event => { if (!root.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  function close(restoreFocus) {
    setOpen(false)
    if (restoreFocus) trigger.current?.focus()
  }

  return (
    <div
      className="account-control"
      ref={root}
      onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); close(true) } }}
      onBlur={event => { if (open && !root.current.contains(event.relatedTarget)) setOpen(false) }}
    >
      <button
        ref={trigger}
        type="button"
        className="account-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(value => !value)}
      >
        <span className="avatar" aria-hidden="true">{initials(session.user.name)}</span>
        <span className="account-label">Account</span>
        <ChevronDown className="cs-icon account-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="account-panel" id={panelId}>
          <p className="account-name">{session.user.name}</p>
          <Link to="/profile" onClick={() => close(false)}><UserRound className="cs-icon" aria-hidden="true" />Profile</Link>
          {organizer && <Link to="/organizer" onClick={() => close(false)}><Users className="cs-icon" aria-hidden="true" />Organizer</Link>}
          {admin && <Link to="/admin/bookings" onClick={() => close(false)}><ShieldCheck className="cs-icon" aria-hidden="true" />Booking review</Link>}
          {admin && <Link to="/admin/schedule" onClick={() => close(false)}><CalendarDays className="cs-icon" aria-hidden="true" />Venue schedule</Link>}
          <Link to="/credits" onClick={() => close(false)}><Info className="cs-icon" aria-hidden="true" />Credits</Link>
          <button type="button" className="sign-out" onClick={() => { close(false); onSignOut() }}>
            <LogOut className="cs-icon" aria-hidden="true" />Sign out
          </button>
        </div>
      )}
    </div>
  )
}
