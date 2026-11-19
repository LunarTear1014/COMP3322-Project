import { ErrorNotice } from './common'
import { RemovalDecision } from './RemovalDecision'
import { StatusChip, useToast } from './ui'
import { useAction, useResource } from '../hooks/resources'
import { useNotificationSignal } from '../hooks/useLiveSignal'
import { timeLine } from '../lib/format'

export const REMOVAL_NOTES = ['member_removal_request', 'member_removal_decided']

// The decision call, shared by the queue, the members table and the inbox.
export const decideRemoval = (action, clubId, request, decision, reason) => action.run(
  `/clubs/${clubId}/removal-requests/${request.id}/decision`, 'POST',
  { decision, expected_version: request.version, ...(decision === 'reject' ? { reason } : {}) },
)

// One club's pending removal requests, for the president's sign-off list on
// Organizer home. Renders nothing when there is nothing to decide.
export function RemovalQueue({ club, onChange }) {
  const queue = useResource(`/clubs/${club.club_id}/removal-requests`)
  const toast = useToast()
  const action = useAction(() => { queue.refresh(); onChange?.() })
  useNotificationSignal(note => REMOVAL_NOTES.includes(note?.type) && Number(note.club_id) === club.club_id, queue.refresh)
  const items = queue.data ?? []
  if (!items.length) return queue.error ? <ErrorNotice error={queue.error} /> : null

  async function decide(request, decision, reason) {
    const result = await decideRemoval(action, club.club_id, request, decision, reason)
    if (result) toast.show({ message: decision === 'approve' ? `${request.user.name} was removed from ${club.club_name}.` : `Kept ${request.user.name} in ${club.club_name}.`, tone: decision === 'approve' ? 'info' : undefined })
  }

  return (
    <section aria-labelledby={`removals-${club.club_id}`}>
      <h2 id={`removals-${club.club_id}`} className="section-title">Member removals waiting for your sign-off <span className="cs-meta">· {club.club_name}</span> <span className="cs-meta cs-nums">({items.length})</span></h2>
      <ErrorNotice error={action.error} />
      <ul className="stack-list">
        {items.map(request => (
          <li key={request.id} className="signoff-item">
            <div>
              <h3>Remove {request.user.name}</h3>
              <p className="cs-meta">
                {request.requested_by ? `${request.requested_by.name} asked` : 'Asked'} · {timeLine(request.created_at)} Hong Kong time
              </p>
              {request.reason && <p className="cs-meta">Reason given: {request.reason}</p>}
              <StatusChip state="awaiting_president" label="Needs your sign-off" />
            </div>
            <RemovalDecision name={request.user.name} busy={action.busy} onDecide={(decision, reason) => decide(request, decision, reason)} />
          </li>
        ))}
      </ul>
    </section>
  )
}
