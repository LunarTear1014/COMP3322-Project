import { lazy, Suspense, useState } from 'react'
import { useParams } from 'react-router'
import { query, campusTime, campusDate, campusInstant, addDays } from '../api'
import { Resource } from '../components/common'
import { useResource, useAllOptions } from '../hooks/resources'

const ReportFigures = lazy(() => import('../ReportFigures'))
export function Reports() {
  const { id } = useParams()
  const [today] = useState(() => campusDate(new Date()))
  const [from, setFrom] = useState(addDays(today, -29))
  const [to, setTo] = useState(addDays(today, 1))
  const valid = from && to && from < to && (new Date(to) - new Date(from)) / 86400000 <= 93
  const report = useResource(valid ? `/clubs/${id}/reports${query({ from: campusInstant(from), to: campusInstant(to) })}` : null)
  const clubs = useAllOptions('/clubs')
  const data = report.data
  return <main>
    <h1>{clubs.data?.find(club => String(club.id) === id)?.name || 'Club'} reports</h1>
    <p>Hong Kong dates. End date is exclusive. Maximum 93 days.</p>
    <div className="filters"><label>From<input type="date" value={from} onChange={e => setFrom(e.target.value)}/></label><label>Until (exclusive)<input type="date" value={to} onChange={e => setTo(e.target.value)}/></label></div>
    {!valid && <p role="alert">Choose a valid range of at most 93 days.</p>}
    {valid && <Resource value={report}>{data && <>
      <p>Registration action history is complete from {campusTime(data.history_complete_from)} HKT.{new Date(data.from) < new Date(data.history_complete_from) && ' Earlier history is incomplete for this period.'}</p>
      <p className="report-summary">{data.events.length} {data.events.length === 1 ? 'event' : 'events'} · {data.events.reduce((sum, event) => sum + event.joined_count, 0)} currently joined · {data.events.reduce((sum, event) => sum + event.waitlisted_count, 0)} waitlisted</p>
      <Suspense fallback={<p role="status">Loading report figures…</p>}><ReportFigures data={data}/></Suspense>
    </>}</Resource>}
  </main>
}
