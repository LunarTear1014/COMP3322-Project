import { useState } from 'react'
import { query } from '../api'
import { ErrorNotice, Pagination, Resource } from './common'
import { Button, useToast } from './ui'
import { useAction, useResource } from '../hooks/resources'
import { attendanceChanged, eventChanged, useLiveSignal } from '../hooks/useLiveSignal'
import { timeLine } from '../lib/format'

// Organizer check-in: open it, show the big code, and mark or unmark people.
export function CheckinPanel({ event }) {
  const [code, setCode] = useState(null)
  const [page, setPage] = useState(1)
  const toast = useToast()
  const attendance = useResource(`/events/${event.id}/attendance${query({ page })}`)
  const joined = useResource(`/events/${event.id}/participants${query({ status: 'joined', page_size: 100 })}`)
  const action = useAction(() => attendance.refresh())
  // Arrivals appear as students check in; the joined list follows registrations.
  useLiveSignal(attendanceChanged(event.id), attendance.refresh, { wait: 400 })
  useLiveSignal(eventChanged(event.id), joined.refresh)
  const present = new Set((attendance.data?.records ?? []).map(record => record.user_id))

  async function open() {
    const result = await action.run(`/events/${event.id}/checkin`, 'POST', {})
    if (result) {
      setCode(result.data)
      toast.show({ message: 'Check-in is open. Joined students were told.' })
    }
  }

  return (
    <section className="checkin-panel" aria-labelledby="checkin-title">
      <h2 id="checkin-title" className="section-title">Check-in</h2>
      <p className="cs-hint">Opens 30 minutes before the start and closes 2 hours after the end. Only people who joined can check in.</p>
      <ErrorNotice error={action.error} />
      {code ? (
        <div className="checkin-code" role="status" aria-live="polite">
          <span className="cs-meta">Show this code</span>
          <strong aria-label={`Check-in code ${code.code.split('').join(' ')}`}>{code.code}</strong>
          <span className="cs-meta">Open until {timeLine(code.closes_at)}</span>
        </div>
      ) : (
        <Button variant="primary" busy={action.busy} onClick={open}>Open check-in</Button>
      )}
      <h3>Attendance</h3>
      <Resource value={attendance} allowEmpty>
        <p className="cs-meta cs-nums" role="status">{attendance.data?.attended ?? 0} of {attendance.data?.joined_at_open ?? 0} joined have checked in</p>
      </Resource>
      <Resource value={joined} empty="Nobody has joined yet.">
        <ul className="stack-list">
          {joined.data?.map(person => {
            const here = present.has(person.user.id)
            return (
              <li key={person.user.id} className="attendee-row">
                <span>{person.user.name}</span>
                <span className="cs-chip cs-chip-neutral">{here ? 'Checked in' : 'Not yet'}</span>
                <Button
                  disabled={action.busy}
                  aria-label={`${here ? 'Unmark' : 'Mark'} ${person.user.name} as present`}
                  onClick={() => (here
                    ? action.run(`/events/${event.id}/attendance/${person.user.id}`, 'DELETE', {})
                    : action.run(`/events/${event.id}/attendance/${person.user.id}`, 'PUT', {}))}
                >{here ? 'Unmark' : 'Mark present'}</Button>
              </li>
            )
          })}
        </ul>
        <Pagination meta={joined.meta} page={1} setPage={setPage} />
      </Resource>
    </section>
  )
}
