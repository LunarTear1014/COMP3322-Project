import { useState } from 'react'
import { query } from '../api'
import { ErrorNotice, Pagination, Resource } from './common'
import { Button, TextField, useToast } from './ui'
import { useAction, useResource } from '../hooks/resources'
import { timeLine } from '../lib/format'

// Members-only events: the committee accepts or rejects each member's request.
// Accepting uses the current seats and the student's waitlist choice; a full
// event without that consent answers EVENT_FULL and the request stays.
export function JoinRequestsPanel({ event, onDecided }) {
  const [page, setPage] = useState(1)
  const [rejecting, setRejecting] = useState(null)
  const [reason, setReason] = useState('')
  const toast = useToast()
  const requests = useResource(`/events/${event.id}/join-requests${query({ page })}`)
  const action = useAction(() => { requests.refresh(); onDecided?.() })

  async function decide(person, decision) {
    const body = decision === 'reject' && reason.trim() ? { decision, reason: reason.trim() } : { decision }
    const result = await action.run(`/events/${event.id}/join-requests/${person.user.id}/decision`, 'POST', body)
    if (!result) return
    setRejecting(null)
    setReason('')
    const status = result.data?.status
    toast.show({
      message: decision === 'reject' ? `${person.user.name}’s request was rejected.`
        : status === 'waitlisted' ? `${person.user.name} is on the waitlist.` : `${person.user.name} is going.`,
      tone: decision === 'reject' ? 'info' : undefined,
    })
  }

  return (
    <section className="join-requests" aria-labelledby="join-requests-title">
      <h2 id="join-requests-title" className="section-title">
        Join requests{requests.meta ? ` (${requests.meta.total})` : ''}
      </h2>
      <p className="cs-hint">Members-only event. Members ask to join; you decide. Committee members register directly.</p>
      <ErrorNotice error={action.error} />
      <Resource value={requests} empty="No requests waiting.">
        <ul className="stack-list">
          {requests.data?.map(person => (
            <li key={person.user.id} className="join-request">
              <div>
                <p className="fact-main">{person.user.name}</p>
                <p className="cs-meta">
                  {person.user.student_id} · asked {timeLine(person.requested_at)}
                  {person.allow_waitlist ? ' · will take a waitlist place' : ' · seat only, no waitlist'}
                </p>
              </div>
              {rejecting === person.user.id ? (
                <div className="cs-col">
                  <TextField label="Reason (optional)" hint="The student sees this." name="reason" maxLength={500} value={reason} onChange={ev => setReason(ev.target.value)} />
                  <div className="cs-row">
                    <Button variant="danger" busy={action.busy} onClick={() => decide(person, 'reject')}>Reject request</Button>
                    <Button variant="ghost" disabled={action.busy} onClick={() => { setRejecting(null); setReason('') }}>Keep it</Button>
                  </div>
                </div>
              ) : (
                <div className="cs-row">
                  <Button variant="primary" busy={action.busy} onClick={() => decide(person, 'accept')}>Accept</Button>
                  <Button disabled={action.busy} onClick={() => setRejecting(person.user.id)}>Reject</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <Pagination meta={requests.meta} page={page} setPage={setPage} />
      </Resource>
    </section>
  )
}
