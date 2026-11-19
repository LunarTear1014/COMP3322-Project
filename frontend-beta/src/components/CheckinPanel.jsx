import { useEffect, useState } from 'react'
import { query } from '../api'
import { ErrorNotice, Pagination, Resource } from './common'
import { Button, useToast } from './ui'
import { useAction, useResource } from '../hooks/resources'
import { attendanceChanged, eventChanged, useLiveSignal } from '../hooks/useLiveSignal'
import { timeLine } from '../lib/format'

const ROSTER_PAGE_SIZE = 100

// Check-in opens 30 minutes before the start and closes 2 hours after the end
// (the server enforces the same window).
function checkinWindow(event) {
  return {
    opens: new Date(new Date(event.start_at).getTime() - 30 * 60_000),
    closes: new Date(new Date(event.end_at).getTime() + 2 * 3_600_000),
  }
}

// Re-renders every 30 seconds so Open check-in enables at its boundary.
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

// Organizer check-in: open it, show the big code, and mark or unmark people.
export function CheckinPanel({ event }) {
  const [code, setCode] = useState(null)
  const [page, setPage] = useState(1)
  const toast = useToast()
  const now = useNow()
  const { opens, closes } = checkinWindow(event)
  const early = now < opens
  const late = now > closes
  const attendance = useResource(`/events/${event.id}/attendance${query({ page_size: 1 })}`)
  const joined = useResource(`/events/${event.id}/participants${query({ status: 'joined', page_size: ROSTER_PAGE_SIZE, page })}`)
  const action = useAction(() => { attendance.refresh(); joined.refresh() })
  // Arrivals appear as students check in; the joined list follows registrations.
  useLiveSignal(attendanceChanged(event.id), () => { attendance.refresh(); joined.refresh() }, { wait: 400 })
  useLiveSignal(eventChanged(event.id), joined.refresh)

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
        <div className="cs-row">
          <Button variant="primary" busy={action.busy} disabled={early || late} onClick={open} aria-describedby="checkin-window">Open check-in</Button>
          <span id="checkin-window" className="cs-hint" role="status">
            {early ? `Available from ${timeLine(opens)} Hong Kong time.` : late ? `Check-in closed ${timeLine(closes)} Hong Kong time.` : `Open until ${timeLine(closes)} Hong Kong time.`}
          </span>
        </div>
      )}
      <h3>Attendance</h3>
      <Resource value={attendance} allowEmpty>
        <p className="cs-meta cs-nums" role="status">{attendance.data?.attended ?? 0} of {attendance.data?.joined_at_open ?? 0} joined have checked in</p>
      </Resource>
      <Resource value={joined} empty="Nobody has joined yet.">
        <ul className="stack-list">
          {joined.data?.map(person => {
            const here = Boolean(person.checked_in)
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
        {/* The roster's own page state (ATT-06): page 2 shows attendee 101. */}
        <Pagination meta={joined.meta} page={page} setPage={setPage} />
      </Resource>
    </section>
  )
}
