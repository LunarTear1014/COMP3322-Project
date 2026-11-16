import { useEffect, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router'
import { query, campusInstant, usesMainBackend } from '../api'
import { ErrorNotice, Feedback, PageHeading, Pagination, Resource } from '../components/common'
import { LifecycleStepper } from '../components/LifecycleStepper'
import { Button, ButtonLink, StatusChip, TextField, useToast } from '../components/ui'
import { useAction, useResource } from '../hooks/resources'
import { timeLine } from '../lib/format'
import { lifecycle } from '../lib/lifecycle'

const TABS = [{ id: 'overview', label: 'Overview' }, { id: 'edit', label: 'Edit' }, { id: 'people', label: 'People' }]
const hkLocal = value => (value
  ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)).replace(' ', 'T')
  : '')

export function ManageEvent() {
  const { id } = useParams()
  return <ManageEventEditor key={id} id={id} />
}

// Manage event: Overview (progress and next action), Edit, and People, with an
// in-page cancel confirmation. The tab is kept in the URL.
export function ManageEventEditor({ id }) {
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const toast = useToast()
  const tab = TABS.some(item => item.id === params.get('tab')) ? params.get('tab') : 'overview'
  const event = useResource(`/events/${id}`)
  const [form, setForm] = useState(null)
  const [reason, setReason] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [status, setStatus] = useState('joined')
  const [page, setPage] = useState(1)
  const e = event.data
  const canManage = !usesMainBackend || e?.can_cancel
  const participants = useResource(canManage && e ? `/events/${id}/participants${query({ status, page })}` : null)
  const action = useAction(event.refresh)

  useEffect(() => {
    if (event.data) setForm(current => current || {
      title: event.data.title, description: event.data.description, capacity: String(event.data.capacity),
      visibility: event.data.visibility, registration_closes_at: hkLocal(event.data.registration_closes_at),
    })
  }, [event.data])

  const select = next => setParams(next === 'overview' ? {} : { tab: next })
  const field = name => ({ name, value: form?.[name] ?? '', onChange: x => setForm({ ...form, [name]: x.target.value }) })

  async function save(ev) {
    ev.preventDefault()
    const body = usesMainBackend ? { title: form.title, description: form.description } : { expected_version: e.version, title: form.title, description: form.description }
    if (e.state === 'draft') {
      Object.assign(body, { capacity: Number(form.capacity), visibility: form.visibility, registration_closes_at: campusInstant(form.registration_closes_at.slice(0, 10), form.registration_closes_at.slice(11, 16)) })
    }
    const result = await action.run(`/events/${id}`, 'PATCH', body)
    if (result) toast.show({ message: 'Changes saved.' })
  }
  async function publish() {
    const result = await action.run(`/events/${id}/publish`, 'POST', { expected_version: e.version })
    if (result) toast.show({ message: 'Event published. Students can join now.' })
  }
  async function cancel(ev) {
    ev.preventDefault()
    const result = await action.run(`/events/${id}/cancel`, 'POST', { expected_version: e.version, reason })
    if (result) { setConfirming(false); toast.show({ message: 'Event cancelled.', tone: 'info' }) }
  }

  const progress = e ? lifecycle(e) : null
  const copyState = e && { copyEvent: { club_id: e.club?.id, venue_id: e.venue?.id, title: e.title, description: e.description, visibility: e.visibility, capacity: e.capacity } }
  return (
    <main className="page manage-page">
      <Resource value={event}>
        {e && form && (
          <>
            <PageHeading title={e.title} description={`${e.club?.name} · ${timeLine(e.start_at, e.end_at)} · ${e.venue?.name} (Hong Kong time)`} />
            {location.state?.created && <p role="status" className="notice notice-info">{usesMainBackend ? 'Venue booked and event published.' : 'Request submitted; venue approval pending.'}</p>}
            <div className="cs-row status-row">
              <StatusChip state={e.state} label={`Event: ${e.state}`} />
              {e.booking?.status && <StatusChip state={e.booking.status} label={`Booking: ${e.booking.status}`} />}
            </div>
            <ErrorNotice error={action.error} />

            <div className="tabs" role="tablist" aria-label="Manage event">
              {TABS.filter(item => item.id !== 'people' || canManage).map(item => (
                <button key={item.id} type="button" role="tab" className="tab-link" aria-selected={tab === item.id} aria-controls="manage-panel" onClick={() => select(item.id)}>{item.label}</button>
              ))}
            </div>

            <div id="manage-panel" role="tabpanel">
              {tab === 'overview' && (
                <section className="overview">
                  {progress ? <LifecycleStepper steps={progress.steps} /> : <p><StatusChip state="cancelled" /> This event was cancelled.</p>}
                  {progress?.next && (
                    <div className="cs-row next-action">
                      {progress.next.kind === 'publish' && <Button variant="primary" busy={action.busy} onClick={publish}>Publish event</Button>}
                      {progress.next.kind === 'rerequest' && <ButtonLink variant="primary" to="/bookings/new" state={copyState}>{progress.next.label}</ButtonLink>}
                      {progress.next.hint && <span className="cs-hint">{progress.next.hint}</span>}
                    </div>
                  )}
                  {e.booking?.decision_reason && <p>Decision reason: {e.booking.decision_reason}</p>}
                  <p>To reschedule, start a new request. Creating a new event does not cancel this event.</p>
                  {canManage && <Link to="/bookings/new" state={copyState}>Copy details to a new request</Link>}
                  {e.state !== 'cancelled' && canManage && (!usesMainBackend || e.phase !== 'past') && (
                    confirming ? (
                      <form className="inline-confirm" onSubmit={cancel}>
                        <h2>Cancel this event?</h2>
                        <p>Cancellation affects the booking and every active registration. This can’t be undone.</p>
                        {!usesMainBackend && <TextField as="textarea" label="Reason" required maxLength={500} value={reason} onChange={x => setReason(x.target.value)} />}
                        <div className="cs-row">
                          <Button variant="danger" type="submit" busy={action.busy}>Cancel event</Button>
                          <Button onClick={() => setConfirming(false)}>Keep event</Button>
                        </div>
                      </form>
                    ) : <div><Button variant="danger" onClick={() => setConfirming(true)}>Cancel event</Button></div>
                  )}
                </section>
              )}

              {tab === 'edit' && (
                e.state === 'cancelled' || (usesMainBackend && !e.can_cancel) ? <p className="cs-meta">This event can’t be edited.</p> : (
                  <form className="request-form" onSubmit={save}>
                    <h2 className="section-title">Edit event</h2>
                    <TextField label="Title" required maxLength={255} {...field('title')} />
                    <TextField as="textarea" label="Description" required maxLength={10000} rows={5} {...field('description')} />
                    {e.state === 'draft' && (
                      <>
                        <TextField label="Capacity" type="number" inputMode="numeric" required min="1" max="500" {...field('capacity')} />
                        <TextField as="select" label="Visibility" {...field('visibility')}>
                          <option value="public">Public</option>
                          <option value="members_only">Members only</option>
                        </TextField>
                        <TextField label="Registration deadline (Hong Kong time)" type="datetime-local" required {...field('registration_closes_at')} />
                      </>
                    )}
                    {e.state === 'published' && <p className="cs-hint">After publishing, only the title and description can change.</p>}
                    <Feedback action={{ ...action, error: null }} />
                    <div className="step-actions"><Button variant="primary" type="submit" busy={action.busy}>Save changes</Button></div>
                  </form>
                )
              )}

              {tab === 'people' && canManage && (
                <section>
                  <h2 className="section-title">Participants</h2>
                  <TextField as="select" label="Filter" value={status} onChange={ev => { setStatus(ev.target.value); setPage(1) }}>
                    {(usesMainBackend ? ['joined', 'waitlisted'] : ['joined', 'waitlisted', 'left', 'cancelled']).map(x => <option key={x}>{x}</option>)}
                  </TextField>
                  <Resource value={participants} empty="No participants in this state.">
                    <div className="cs-tablewrap" role="region" aria-label="Participants" tabIndex={0}>
                      <table className="cs-table">
                        <thead><tr><th>Name</th>{!usesMainBackend && <><th>Email</th><th>Student ID</th></>}<th>Status</th>{!usesMainBackend && <th>Queue position</th>}</tr></thead>
                        <tbody>
                          {participants.data?.map(p => (
                            <tr key={p.user.id}>
                              <td>{p.user.name}</td>
                              {!usesMainBackend && <><td>{p.user.email}</td><td>{p.user.student_id}</td></>}
                              <td>{p.status}</td>
                              {!usesMainBackend && <td>{p.queue_position ?? '—'}</td>}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Pagination meta={participants.meta} page={page} setPage={setPage} />
                  </Resource>
                </section>
              )}
            </div>
          </>
        )}
      </Resource>
    </main>
  )
}
