import { BarChart } from '@mui/x-charts/BarChart'
import { Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material'

const metrics = ['joined', 'waitlisted', 'left', 'promoted', 'cancelled']
// Theme tokens, so the bars stay readable in light and dark mode.
const chartColors = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']

const pct = value => (value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`)

function EventVisits({ visits, events }) {
  const totals = visits?.totals
  const titles = new Map(events.map(event => [event.event_id, event.title]))
  const rows = (visits?.events ?? []).filter(row => row.visitors > 0)
  const stages = totals ? [
    { stage: 'Visitors', members: totals.member_visitors, non_members: totals.non_member_visitors },
    { stage: 'Clicked Join', members: totals.member_clicked_join, non_members: totals.non_member_clicked_join },
  ] : []
  return <section className="panel event-visits"><h2>Event page visits</h2>
    <p>People who opened an event page, split into club members and non-members, and how many of them then clicked Join. Each person counts once per event. Your club's committee, president and venue admins are not counted. Clicked Join includes joining the waitlist and members-only requests made after opening the page.</p>
    {totals && totals.visitors > 0 ? <>
      <BarChart colors={chartColors} height={240} dataset={stages} xAxis={[{scaleType:'band',dataKey:'stage',height:40}]} yAxis={[{label:'People',min:0,tickMinStep:1}]} series={[{dataKey:'members',label:'Members'},{dataKey:'non_members',label:'Non-members'}]} skipAnimation/>
      <div className="table-wrap" role="region" aria-label="Scrollable report table" tabIndex={0}><Table size="small"><TableHead><TableRow><TableCell>Event</TableCell><TableCell>Visitors (members / non-members)</TableCell><TableCell>Clicked Join (members / non-members)</TableCell><TableCell>Join rate</TableCell></TableRow></TableHead><TableBody>
        {rows.map(row => <TableRow key={row.event_id}><TableCell>{titles.get(row.event_id) ?? `Event ${row.event_id}`}</TableCell><TableCell>{row.visitors} ({row.member_visitors} / {row.non_member_visitors})</TableCell><TableCell>{row.clicked_join} ({row.member_clicked_join} / {row.non_member_clicked_join})</TableCell><TableCell>{pct(row.join_rate)}</TableCell></TableRow>)}
        <TableRow><TableCell component="th" scope="row"><strong>Total</strong></TableCell><TableCell>{totals.visitors} ({totals.member_visitors} / {totals.non_member_visitors})</TableCell><TableCell>{totals.clicked_join} ({totals.member_clicked_join} / {totals.non_member_clicked_join})</TableCell><TableCell>{pct(totals.join_rate)} (members {pct(totals.member_join_rate)}, non-members {pct(totals.non_member_join_rate)})</TableCell></TableRow>
      </TableBody></Table></div>
    </> : <p>No one has opened these event pages yet.</p>}
  </section>
}

export default function ReportFigures({ data }) {
  return <>
      <section className="panel"><h2>Current participant counts</h2>{data.events.length ? <div className="table-wrap" role="region" aria-label="Scrollable report table" tabIndex={0}><Table size="small"><TableHead><TableRow>{['Event','State','Capacity','Joined','Waitlisted'].map(label => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead><TableBody>{data.events.map(event => <TableRow key={event.event_id}>{[event.title,event.state,event.capacity,event.joined_count,event.waitlisted_count].map((value,index) => <TableCell key={index}>{value}</TableCell>)}</TableRow>)}</TableBody></Table></div> : <p>No events in this period.</p>}</section>
      <EventVisits visits={data.event_visits} events={data.events}/>
      <section className="panel"><h2>Daily registration actions</h2><p>Join, waitlist, leave, promote and cancel actions. These figures do not measure attendance.</p>{data.daily_actions.length ? <><BarChart colors={chartColors} height={300} dataset={data.daily_actions} xAxis={[{scaleType:'band',dataKey:'date',label:'Hong Kong date',height:50,valueFormatter: value => value.slice(5),tickLabelInterval: (_value, index) => index === 0 || index === data.daily_actions.length - 1}]} yAxis={[{label:'Registration actions'}]} series={metrics.map(key => ({dataKey:key,label:key,stack:'actions'}))} skipAnimation/><details className="report-table"><summary>View daily action data</summary><div className="table-wrap" role="region" aria-label="Scrollable report table" tabIndex={0}><Table size="small"><TableHead><TableRow><TableCell>Date</TableCell>{metrics.map(key => <TableCell key={key}>{key}</TableCell>)}</TableRow></TableHead><TableBody>{data.daily_actions.map(day => <TableRow key={day.date}><TableCell>{day.date}</TableCell>{metrics.map(key => <TableCell key={key}>{day[key]}</TableCell>)}</TableRow>)}</TableBody></Table></div></details></> : <p>No action data for this period.</p>}</section>
      <section className="panel venue-hours"><h2>Confirmed venue hours</h2>{data.venue_hours.length ? <><ul className="venue-key">{data.venue_hours.map((venue, index) => <li key={venue.venue_id}>V{index + 1}: {venue.venue_name}</li>)}</ul><BarChart colors={chartColors} height={Math.max(220,data.venue_hours.length*60)} layout="horizontal" dataset={data.venue_hours.map((venue, index) => ({...venue, venue_label: `V${index + 1}`}))} yAxis={[{scaleType:'band',dataKey:'venue_label',width:45}]} xAxis={[{label:'Hours',min:0,tickMinStep:1,height:50}]} series={[{dataKey:'hours',label:'Confirmed hours'}]} skipAnimation/><div className="table-wrap" role="region" aria-label="Scrollable report table" tabIndex={0}><Table size="small"><TableHead><TableRow><TableCell>Venue</TableCell><TableCell>Hours</TableCell></TableRow></TableHead><TableBody>{data.venue_hours.map(venue => <TableRow key={venue.venue_id}><TableCell>{venue.venue_name}</TableCell><TableCell>{venue.hours}</TableCell></TableRow>)}</TableBody></Table></div></> : <p>No confirmed venue hours in this period.</p>}</section>
  </>
}
