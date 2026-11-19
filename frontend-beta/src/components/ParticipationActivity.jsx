import { useState } from 'react'
import { query } from '../api'
import { Pagination, Resource } from './common'
import { TextField } from './ui'
import { useResource } from '../hooks/resources'
import { eventChanged, useLiveSignal } from '../hooks/useLiveSignal'
import { timeLine } from '../lib/format'
import { roleChip } from '../lib/people'

const PAGE_SIZE = 10
const FILTERS = [['', 'All'], ['joined', 'Joined'], ['left', 'Quit'], ['waitlisted', 'Waitlisted'], ['promoted', 'Promoted']]

// What happened, in words. A "joined" that follows a quit reads as a rejoin.
function what(entry) {
  switch (entry.action) {
    case 'joined': return entry.from_status === 'left' ? 'rejoined' : 'joined'
    case 'waitlisted': return 'joined the waitlist'
    case 'left': return 'quit'
    case 'promoted': return 'promoted from the waitlist'
    case 'cancelled': return 'registration cancelled with the event'
    default: return entry.action
  }
}

function plural(count, one, many = `${one}s`) { return `${count} ${count === 1 ? one : many}` }

export function summaryLine(summary) {
  if (!summary) return ''
  const parts = [`${summary.joined_people} joined`, `${summary.quit_people} quit`]
  if (summary.rejoined_people) parts.push(`${summary.rejoined_people} rejoined`)
  if (summary.promoted) parts.push(`${summary.promoted} promoted from the waitlist`)
  return parts.join(' · ')
}

// Organizer view: who joined or quit this event, newest first. The summary
// covers the whole event; the filter only narrows the list below it.
export function ParticipationActivity({ event }) {
  const [action, setAction] = useState('')
  const [page, setPage] = useState(1)
  const activity = useResource(`/events/${event.id}/participation-history${query({ action, page, page_size: PAGE_SIZE })}`)
  useLiveSignal(eventChanged(event.id), activity.refresh)
  const summary = activity.summary
  return (
    <section aria-labelledby="activity-title" className="participation-activity">
      <h2 id="activity-title" className="section-title">Join and quit activity</h2>
      {summary && (
        <>
          <p className="fact-main" aria-label="Summary">{summaryLine(summary)}</p>
          <p className="cs-meta">Now: {summary.currently_joined} going, {summary.currently_waitlisted} on the waitlist. Times are Hong Kong time.</p>
        </>
      )}
      <TextField as="select" label="Show" value={action} onChange={ev => { setAction(ev.target.value); setPage(1) }}>
        {FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </TextField>
      <Resource value={activity} empty={action ? 'Nothing matches this filter.' : 'No one has joined or quit yet.'}>
        <ul className="stack-list" aria-label="Join and quit activity">
          {activity.data?.map(entry => {
            const chip = roleChip(entry.club_role)
            const reason = entry.reason === 'membership_ineligible' ? ' (no longer a club member)' : ''
            return (
              <li key={entry.id} className="activity-entry">
                <strong>{entry.user.name}</strong>
                {' · '}<span className={`cs-chip ${chip.className}`}>{chip.label}</span>
                {' · '}{what(entry)}{reason}
                {entry.by && entry.action !== 'promoted' && <> (by {entry.by.name})</>}
                {' · '}<span className="cs-meta">{timeLine(entry.occurred_at)}</span>
              </li>
            )
          })}
        </ul>
        <Pagination meta={activity.meta} page={page} setPage={setPage} />
      </Resource>
    </section>
  )
}
