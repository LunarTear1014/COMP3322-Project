import { useState } from 'react'
import { Button, TextField } from './ui'

// The president's two answers to a removal request. Reject asks for a reason
// (the committee member who asked sees it). `onDecide(decision, reason)` runs
// the request; the form closes on its own once the answer is sent.
export function RemovalDecision({ name, busy, onDecide, approveVariant = 'primary' }) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  if (rejecting) {
    return (
      <form className="inline-confirm member-confirm" aria-label={`Reject removing ${name}`} onSubmit={async event => { event.preventDefault(); await onDecide('reject', reason.trim()); setRejecting(false); setReason('') }}>
        <TextField as="textarea" label={`Why not remove ${name}?`} hint="The committee member who asked sees this. Required." required maxLength={500} rows={3} value={reason} onChange={event => setReason(event.target.value)} />
        <div className="cs-row">
          <Button variant="danger" type="submit" busy={busy} disabled={!reason.trim()}>Send rejection</Button>
          <Button type="button" onClick={() => { setRejecting(false); setReason('') }}>Back</Button>
        </div>
      </form>
    )
  }
  return (
    <div className="cs-row">
      <Button variant={approveVariant} busy={busy} aria-label={`Approve removing ${name}`} onClick={() => onDecide('approve')}>Approve removal</Button>
      <Button disabled={busy} aria-label={`Reject removing ${name}`} onClick={() => setRejecting(true)}>Reject</Button>
    </div>
  )
}
