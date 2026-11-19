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
      {/* Each request is its own card so a decision about a person stands
          apart from the event lists around it. */}
      <ul className="removal-cards">
        {items.map(request => (
          <li key={request.id} className="removal-card" aria-labelledby={`removal-${request.id}`}>
            <div className="removal-card-head">
              <span className="removal-card-eyebrow">Member removal · {club.club_name}</span>
              <StatusChip state="awaiting_president" label="Needs your sign-off" />
            </div>
            <h3 id={`removal-${request.id}`} className="removal-card-title">Remove {request.user.name}</h3>
            <p className="cs-meta">
              {request.requested_by ? `${request.requested_by.name} asked` : 'Asked'} · {timeLine(request.created_at)} Hong Kong time
            </p>
            {request.reason && <blockquote className="removal-card-reason"><b>Reason: </b>{request.reason}</blockquote>}
            <div className="removal-card-actions">
              <RemovalDecision name={request.user.name} busy={action.busy} onDecide={(decision, reason) => decide(request, decision, reason)} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
