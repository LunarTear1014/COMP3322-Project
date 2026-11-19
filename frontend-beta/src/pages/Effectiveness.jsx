import { Component, lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { addDays, campusDate, campusInstant, query } from '../api'
import { PageHeading, Resource } from '../components/common'
import { EmptyState, TextField } from '../components/ui'
import { useResource } from '../hooks/resources'
import { dayLabel } from '../lib/format'

const EffectivenessChart = lazy(() => import('../EffectivenessChart'))
const CHART_PATIENCE_MS = 8000

// A chart that fails or never arrives must not leave "Loading chart…" on
// screen forever (F18); the table below always has every number.
class ChartBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed
      ? <p className="cs-meta" role="status">The chart couldn’t be shown. Every number is in the table below.</p>
      : this.props.children
  }
}

function ChartLoading() {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), CHART_PATIENCE_MS)
    return () => clearTimeout(timer)
  }, [])
  return <p role="status">{slow ? 'The chart is taking a while to load. Every number is in the table below.' : 'Loading chart…'}</p>
}

const pct = value => (value === null || value === undefined ? null : `${Math.round(value * 100)}%`)
const NOT_RECORDED = 'Not recorded'
const SOURCES = [['explore', 'Explore'], ['club', 'Club'], ['inbox', 'Inbox'], ['my_events', 'My events'], ['share', 'Shared link'], ['other', 'Other']]

const DEFINITIONS = [
  ['Filled at start', 'People holding a seat when the event started, as a share of capacity.'],
  ['Drop-out', 'People who joined and had left again by the start, as a share of everyone who ever joined.'],
  ['Turnout', 'People who checked in, as a share of those holding a seat at the start. “Not recorded” means check-in was not used for that event.'],
  ['Promoted, checked in', 'Waitlisted students who got a seat and then checked in.'],
  ['Views to joins', 'Students who joined after viewing the event, as a share of unique viewers.'],
  ['Too few events', 'Groups with fewer than 3 events show their numbers as a hint only.'],
]

function Meter({ value, label }) {
  if (value === null || value === undefined) return <span className="cs-meta">{NOT_RECORDED}</span>
  return (
    <span className="rate">
      <span className="cs-meter-track" role="presentation"><span className="cs-meter-fill" style={{ display: 'block', width: `${Math.min(100, Math.round(value * 100))}%` }} /></span>
      <span className="cs-nums" aria-label={label}>{pct(value)}</span>
    </span>
  )
}

function GroupTable({ title, rows, keyName }) {
  if (!rows.length) return null
  return (
    <section aria-label={title}>
      <h3>{title}</h3>
      <div className="cs-tablewrap" role="region" aria-label={`${title} table`} tabIndex={0}>
        <table className="cs-table">
          <thead><tr><th>{keyName}</th><th>Events</th><th>Filled at start</th><th>Turnout</th><th><span className="cs-sr">Note</span></th></tr></thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.slug ?? row.weekday ?? row.slot}>
                <td>{row.name}</td>
                <td>{row.events}</td>
                <td>{pct(row.avg_fill_rate) ?? NOT_RECORDED}</td>
                <td>{pct(row.avg_turnout) ?? NOT_RECORDED}</td>
                <td>{row.too_few ? <span className="cs-chip cs-chip-neutral">Too few events</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// Event effectiveness for one club: fill, turnout, promotion effect and views,
// with honest "Not recorded" and "Too few events" states. Tables carry every
// number, so nothing depends on seeing a chart.
export function Effectiveness() {
  const { id } = useParams()
  const today = campusDate(new Date())
  const [from, setFrom] = useState(addDays(today, -60))
  const [to, setTo] = useState(today)
  const valid = from && to && from <= to && (new Date(to) - new Date(from)) / 86400000 < 93
  const report = useResource(valid ? `/clubs/${id}/reports/effectiveness${query({ from: campusInstant(from, '00:00'), to: campusInstant(addDays(to, 1), '00:00') })}` : null)
  const data = report.data
  const totals = useMemo(() => {
    const events = data?.events ?? []
    return { events: events.length, views: events.reduce((sum, row) => sum + row.views, 0), joined: events.reduce((sum, row) => sum + row.joined_at_start, 0) }
  }, [data])

  return (
    <main className="page">
      <PageHeading title="Event effectiveness" description="How well events fill, who shows up, and what the waitlist and views add. Dates are Hong Kong time." />
      <div className="cs-row range-row">
        <TextField label="From" type="date" value={from} onChange={event => setFrom(event.target.value)} />
        <TextField label="Until (inclusive)" type="date" value={to} error={valid ? undefined : 'Choose dates in order, at most 93 days apart.'} onChange={event => setTo(event.target.value)} />
      </div>
      <Resource value={report} allowEmpty>
        {data && (data.events.length === 0 ? (
          <EmptyState title="No published events in this period">Pick a longer range, or publish an event first.</EmptyState>
        ) : (
          <>
            <p className="cs-meta cs-nums" role="status">{totals.events} events · {totals.joined} seats held at start · {totals.views} views</p>
            <figure className="chart-figure" aria-label="Chart: filled at start and turnout per event">
              <ChartBoundary><Suspense fallback={<ChartLoading />}><EffectivenessChart events={data.events} /></Suspense></ChartBoundary>
              <figcaption className="cs-hint">The table below lists every exact number. Events without check-in have no turnout bar.</figcaption>
            </figure>
            <section aria-label="Per event">
              <div className="cs-tablewrap" role="region" aria-label="Per event table" tabIndex={0}>
                <table className="cs-table">
                  <thead>
                    <tr><th>Event</th><th>Filled at start</th><th>Drop-out</th><th>Peak waitlist</th><th>Turnout</th><th>No-shows</th><th>Promotions</th><th>Median wait (h)</th><th>Promoted, checked in</th><th>Views</th><th>Views to joins</th><th>Joins in first 24 h</th></tr>
                  </thead>
                  <tbody>
                    {data.events.map(row => (
                      <tr key={row.event_id}>
                        <td>{row.title}<br /><span className="cs-meta">{dayLabel(row.start_at)}</span></td>
                        <td><Meter value={row.fill_rate} label={`${row.joined_at_start} of ${row.capacity} seats`} /></td>
                        <td>{pct(row.dropout_rate) ?? '—'}</td>
                        <td>{row.peak_waitlist}</td>
                        <td>{row.checkin_recorded ? <Meter value={row.turnout} label={`${row.attended} checked in`} /> : <span className="cs-meta">{NOT_RECORDED}</span>}</td>
                        <td>{row.no_shows ?? NOT_RECORDED}</td>
                        <td>{row.promotions}</td>
                        <td>{row.median_promotion_wait_hours ?? '—'}</td>
                        <td>{row.promoted_attended ?? NOT_RECORDED}</td>
                        <td>{row.views}<br /><span className="cs-meta">{SOURCES.filter(([key]) => row.views_by_source[key]).map(([key, label]) => `${label} ${row.views_by_source[key]}`).join(' · ') || 'No views'}</span></td>
                        <td>{pct(row.view_to_join) ?? '—'}</td>
                        <td>{row.joins_24h_after_publish}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <GroupTable title="By tag" rows={data.by_tag} keyName="Tag" />
            <GroupTable title="By weekday" rows={data.by_weekday} keyName="Weekday" />
            <GroupTable title="By time slot" rows={data.by_slot} keyName="Slot" />
            <details className="definitions">
              <summary>What these numbers mean</summary>
              <dl>{DEFINITIONS.map(([term, text]) => <div key={term}><dt>{term}</dt><dd>{text}</dd></div>)}</dl>
            </details>
          </>
        ))}
      </Resource>
    </main>
  )
}
