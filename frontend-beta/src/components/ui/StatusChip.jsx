import { Check, Lock, X } from 'lucide-react'

// State words come from the API; colour only reinforces them.
const CHIPS = {
  joined: { className: 'cs-chip-joined', label: 'Joined', icon: Check },
  approved: { className: 'cs-chip-joined', label: 'Approved', icon: Check },
  confirmed: { className: 'cs-chip-joined', label: 'Approved', icon: Check },
  published: { className: 'cs-chip-joined', label: 'Published', icon: Check },
  waitlisted: { className: 'cs-chip-waitlisted', label: 'Waitlisted' },
  pending: { className: 'cs-chip-waitlisted', label: 'Pending approval' },
  awaiting_president: { className: 'cs-chip-waitlisted', label: 'Waiting for the president' },
  returned: { className: 'cs-chip-cancelled', label: 'Returned' },
  members_only: { className: 'cs-chip-members', label: 'Members only', icon: Lock },
  almost_full: { className: 'cs-chip-hot', label: 'Almost full' },
  cancelled: { className: 'cs-chip-cancelled', label: 'Cancelled', icon: X },
  rejected: { className: 'cs-chip-cancelled', label: 'Rejected', icon: X },
  draft: { className: 'cs-chip-neutral', label: 'Draft' },
  left: { className: 'cs-chip-neutral', label: 'Left' },
  none: { className: 'cs-chip-neutral', label: 'Not joined' },
}

export function StatusChip({ state, position, label }) {
  const chip = CHIPS[state]
  if (!chip) return null
  const Icon = chip.icon
  const text = label ?? chip.label
  return (
    <span className={`cs-chip ${chip.className}`}>
      {Icon && <Icon className="cs-icon" aria-hidden="true" />}
      {text}{state === 'waitlisted' && position ? ` · #${position}` : ''}
    </span>
  )
}

// Loud cousins of chips. At most one per cover.
export function Sticker({ tone = 'sun', children }) {
  return <span className={`cs-sticker cs-sticker-${tone}`}>{children}</span>
}

// Almost full means 85% or more of the seats are taken.
export function isAlmostFull(joined, capacity) {
  return capacity > 0 && joined / capacity >= 0.85 && joined < capacity
}
