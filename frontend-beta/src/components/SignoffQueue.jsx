import { useState } from 'react'
import { ErrorNotice } from './common'
import { Button, StatusChip, TextField, useToast } from './ui'
import { useAction, useResource } from '../hooks/resources'
import { timeLine } from '../lib/format'

function Item({ kind, item, action, onDone }) {
  const [returning, setReturning] = useState(false)
  const [reason, setReason] = useState('')
  const toast = useToast()
  const isBooking = kind === 'booking'
  const path = isBooking ? `/bookings/${item.id}/signoff` : `/events/${item.id}/signoff`
  const title = isBooking ? item.event_title : item.title
  const yes = isBooking ? 'send' : 'publish'

  async function decide(decision) {
    const body = { expected_version: item.version, decision, ...(decision === 'return' ? { reason: reason.trim() } : {}) }
    const result = await action.run(path, 'POST', body)
    if (result) {
      toast.show({ message: decision === 'return' ? `Returned ${title}.` : isBooking ? `Sent ${title} to the venue team.` : `Published ${title}.` })
      onDone()
    }
  }

  return (
    <li className="signoff-item">
      <div>
        <h3>{title}</h3>
        <p className="cs-meta">
          {isBooking ? 'Venue request' : 'Publication'} · {timeLine(item.start_at, item.end_at)} Hong Kong time
        </p>
        <StatusChip state="awaiting_president" label="Needs your sign-off" />
      </div>
      {returning ? (
        <form className="inline-confirm" onSubmit={event => { event.preventDefault(); decide('return') }}>
          <TextField as="textarea" label="Reason for returning" hint="The committee sees this. Required." required maxLength={500} rows={3} value={reason} onChange={event => setReason(event.target.value)} />
          <div className="cs-row">
            <Button variant="danger" type="submit" busy={action.busy} disabled={!reason.trim()}>Return request</Button>
            <Button onClick={() => setReturning(false)}>Back</Button>
          </div>
        </form>
      ) : (
        <div className="cs-row">
          <Button variant="primary" busy={action.busy} onClick={() => decide(yes)}>{isBooking ? 'Send to venue team' : 'Publish event'}</Button>
          <Button disabled={action.busy} onClick={() => setReturning(true)}>Return with a reason</Button>
        </div>
      )}
    </li>
  )
}

// The president's queue: committee venue requests and publications waiting for
// sign-off. Shown only to presidents; "Needs the president" is the empty state.
export function SignoffQueue({ onChange }) {
  const queue = useResource('/me/signoffs')
  const action = useAction(() => { queue.refresh(); onChange?.() })
  const bookings = queue.data?.bookings ?? []
  const events = queue.data?.events ?? []
  if (queue.error || !queue.data) return queue.error ? <ErrorNotice error={queue.error} /> : null
  if (!bookings.length && !events.length) return null
  return (
    <section aria-labelledby="signoffs">
      <h2 id="signoffs" className="section-title">Waiting for your sign-off <span className="cs-meta cs-nums">({bookings.length + events.length})</span></h2>
      <ErrorNotice error={action.error} />
      <ul className="stack-list">
        {bookings.map(item => <Item key={`b${item.id}`} kind="booking" item={item} action={action} onDone={queue.refresh} />)}
        {events.map(item => <Item key={`e${item.id}`} kind="event" item={item} action={action} onDone={queue.refresh} />)}
      </ul>
    </section>
  )
}
