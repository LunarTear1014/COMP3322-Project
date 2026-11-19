import { useEffect, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router'
import { query, campusInstant } from '../api'
import { ErrorNotice, Feedback, PageHeading, Pagination, Resource } from '../components/common'
import { LifecycleStepper } from '../components/LifecycleStepper'
import { Button, ButtonLink, StatusChip, TextField, useToast } from '../components/ui'
import { useAction, useResource } from '../hooks/resources'
import { eventChanged, useLiveSignal } from '../hooks/useLiveSignal'
import { timeLine } from '../lib/format'
import { lifecycle } from '../lib/lifecycle'
import { CoverUploader } from '../components/CoverUploader'
import { TagPicker } from '../components/TagPicker'
import { CheckinPanel } from '../components/CheckinPanel'
import { JoinRequestsPanel } from '../components/JoinRequestsPanel'
import { coverForm } from '../lib/cover'

const TABS = [{ id: 'overview', label: 'Overview' }, { id: 'edit', label: 'Edit' }, { id: 'people', label: 'People' }, { id: 'checkin', label: 'Check-in' }]
// Readable status words for the chips (F03): never raw lower_snake_case.
const EVENT_LABEL = { draft: 'Draft', awaiting_president: 'Waiting for the president to publish', published: 'Published', cancelled: 'Cancelled' }
const BOOKING_LABEL = {
  awaiting_president: 'Waiting for president sign-off', pending: 'With the venue team', confirmed: 'Approved',
  rejected: 'Rejected', returned: 'Returned by the president', cancelled: 'Cancelled',
}
const formFrom = data => ({
  title: data.title, description: data.description, capacity: String(data.capacity),
  visibility: data.visibility, registration_closes_at: hkLocal(data.registration_closes_at),
})
const tagsFrom = data => ({ campus: (data.campus_tags ?? []).map(tag => tag.id), club: (data.club_tags ?? []).map(tag => tag.id) })
const hkLocal = value => (value
  ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)).replace(' ', 'T')
  : '')

export function ManageEvent({ session }) {
  const { id } = useParams()
  return <ManageEventEditor key={id} id={id} session={session} />
}

// Manage event: Overview (progress and next action), Edit, and People, with an
// in-page cancel confirmation. The tab is kept in the URL.
export function ManageEventEditor({ id, session }) {
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const toast = useToast()
  const event = useResource(`/events/${id}`)
  const [form, setForm] = useState(null)
  const [reason, setReason] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [status, setStatus] = useState('joined')
  const [page, setPage] = useState(1)
  const [tags, setTags] = useState(null)
  // The version the edit form was loaded from. Saves send it, so an edit made
  // in another tab is never silently overwritten (EVT-08).
  const [baseVersion, setBaseVersion] = useState(null)
  const [dirty, setDirty] = useState(false)
  const e = event.data
  const role = session?.memberships.find(item => item.club_id === e?.club?.id)?.role
  const admin = session?.user.platform_role === 'venue_admin'
  // Only the president (or a venue admin) cancels a published event; committee may cancel drafts.
  const mayCancel = !session || admin || role === 'president' || (role === 'committee' && e?.state !== 'published')
  // Committee and president manage their own club's events; everyone else gets
  // a pointer to the public page instead of an editor they can't use (F02).
  const canManage = !session || role === 'committee' || role === 'president'
  const president = !session || role === 'president'
  const tabs = TABS.filter(item => (item.id === 'overview' || canManage) && (item.id !== 'checkin' || event.data?.state === 'published'))
  const tab = tabs.some(item => item.id === params.get('tab')) ? params.get('tab') : 'overview'
  const participants = useResource(canManage && e ? `/events/${id}/participants${query({ status, page })}` : null)
  const action = useAction(event.refresh)
  // Booking decisions, sign-off, seats and requests update live.
  useLiveSignal(eventChanged(id), () => { event.refresh(); if (canManage) participants.refresh?.() })

  // Load the form once; afterwards follow the server while nothing is typed,
  // and flag a newer version once there are unsaved edits.
  useEffect(() => {
    if (!event.data) return
    if (form === null || (!dirty && event.data.version !== baseVersion)) {
      setForm(formFrom(event.data))
      setTags(tagsFrom(event.data))
      setBaseVersion(event.data.version)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.data])

  const stale = Boolean(e && dirty && baseVersion !== null && e.version !== baseVersion)
  function loadLatest() {
    setForm(formFrom(e))
    setTags(tagsFrom(e))
    setBaseVersion(e.version)
    setDirty(false)
  }
  // A successful write of our own returns the new event: adopt it when the
  // form was in step with the server, so our own change never looks foreign.
  function adopt(result, before) {
    if (result?.data?.version && baseVersion === before) setBaseVersion(result.data.version)
  }

  const select = next => setParams(next === 'overview' ? {} : { tab: next })
  const field = name => ({ name, value: form?.[name] ?? '', onChange: x => { setForm({ ...form, [name]: x.target.value }); setDirty(true) } })
  const [tagError, setTagError] = useState('')

  async function save(ev) {
    ev.preventDefault()
    if (tags && tags.campus.length === 0) { setTagError('Choose 1 to 3 campus tags.'); return }
    setTagError('')
    const body = { expected_version: baseVersion ?? e.version, title: form.title, description: form.description }
    if (e.state === 'draft') {
      Object.assign(body, { capacity: Number(form.capacity), visibility: form.visibility, registration_closes_at: campusInstant(form.registration_closes_at.slice(0, 10), form.registration_closes_at.slice(11, 16)) })
    }
    if (tags) Object.assign(body, { campus_tag_ids: tags.campus, club_tag_ids: tags.club })
    const result = await action.run(`/events/${id}`, 'PATCH', body)
    if (result) {
      if (result.data?.version) { setForm(formFrom(result.data)); setTags(tagsFrom(result.data)); setBaseVersion(result.data.version) }
      setDirty(false)
      toast.show({ message: 'Changes saved.' })
    }
  }
  async function uploadCover({ file, alt }) {
    const before = e.version
    const result = await action.run(`/events/${id}/cover`, 'PUT', coverForm({ file, alt, expectedVersion: e.version }))
    if (result) { adopt(result, before); toast.show({ message: 'Cover saved.' }) }
  }
  async function removeCover() {
    const before = e.version
    const result = await action.run(`/events/${id}/cover`, 'DELETE', { expected_version: e.version })
    if (result) { adopt(result, before); toast.show({ message: 'Cover removed.', tone: 'info' }) }
  }
  // A committee member's publish only asks the president (F01): say so.
  async function publish() {
    const before = e.version
    const result = await action.run(`/events/${id}/publish`, 'POST', { expected_version: e.version })
    if (!result) return
    adopt(result, before)
    const state = result.data?.state ?? (president ? 'published' : 'awaiting_president')
    toast.show(state === 'published'
      ? { message: 'Event published. Students can join now.' }
      : { message: 'Publication requested. Waiting for the president to publish it.', tone: 'info' })
  }
  async function cancel(ev) {
    ev.preventDefault()
    if (!reason.trim()) return
    const result = await action.run(`/events/${id}/cancel`, 'POST', { expected_version: e.version, reason: reason.trim() })
    if (result) { setConfirming(false); toast.show({ message: 'Event cancelled.', tone: 'info' }) }
  }

  const progress = e ? lifecycle(e) : null
  const copyState = e && { copyEvent: {
    club_id: e.club?.id, venue_id: e.venue?.id, title: e.title, description: e.description, visibility: e.visibility, capacity: e.capacity,
    campus_tag_ids: (e.campus_tags ?? []).map(tag => tag.id), club_tag_ids: (e.club_tags ?? []).map(tag => tag.id),
  } }
  const closed = ['rejected', 'returned'].includes(e?.booking?.status)
  const returnedReason = e?.booking?.decision_reason || e?.signoff?.reason
  if (e && session && !canManage && !admin) {
    return (
      <main className="page manage-page">
        <PageHeading title={e.title} description={`${e.club?.name} · ${timeLine(e.start_at, e.end_at)}`} />
        <p className="notice notice-info" role="status">Only {e.club?.name}’s committee can manage this event.</p>
        <ButtonLink to={`/events/${e.id}`}>Open the event page</ButtonLink>
      </main>
    )
  }
  return (
    <main className="page manage-page">
      <Resource value={event}>
        {e && form && (
          <>
            <PageHeading title={e.title} description={`${e.club?.name} · ${timeLine(e.start_at, e.end_at)} · ${e.venue?.name} (Hong Kong time)`} />
            {location.state?.created && (
              <p role="status" className="notice notice-info">
                {e.booking?.status === 'awaiting_president'
                  ? 'Request submitted. Your president signs it off first, then the venue team reviews it.'
                  : 'Request submitted. The venue team will review it.'}
              </p>
            )}
            <div className="cs-row status-row">
              <StatusChip state={e.state} label={`Event: ${EVENT_LABEL[e.state] ?? e.state}`} />
              {e.booking?.status && <StatusChip state={e.booking.status} label={`Venue: ${BOOKING_LABEL[e.booking.status] ?? e.booking.status}`} />}
            </div>
            <ErrorNotice error={action.error} />

            <div className="tabs" role="tablist" aria-label="Manage event">
              {tabs.map(item => (
                <button key={item.id} type="button" role="tab" className="tab-link" aria-selected={tab === item.id} aria-controls="manage-panel" onClick={() => select(item.id)}>{item.label}{item.id === 'people' && e.pending_join_requests > 0 && <span className="tab-count" aria-label={`${e.pending_join_requests} join requests`}>{e.pending_join_requests}</span>}</button>
              ))}
            </div>

            <div id="manage-panel" role="tabpanel">
              {tab === 'overview' && (
                <section className="overview">
                  {progress ? <LifecycleStepper steps={progress.steps} /> : <p><StatusChip state="cancelled" /> This event was cancelled.</p>}
                  {progress?.next && (
                    <div className="cs-row next-action">
                      {progress.next.kind === 'publish' && canManage && <Button variant="primary" busy={action.busy} onClick={publish}>{president ? 'Publish event' : 'Request publication'}</Button>}
                      {progress.next.kind === 'rerequest' && <ButtonLink variant="primary" to="/bookings/new" state={copyState}>{progress.next.label}</ButtonLink>}
                      {progress.next.hint && <span className="cs-hint">{progress.next.hint}</span>}
                    </div>
                  )}
                  {e.booking?.decision_reason && <p>Decision reason: {e.booking.decision_reason}</p>}
                  {progress?.next?.kind === 'publish' && canManage && !president && <p className="cs-hint">Your president publishes it after you request publication.</p>}
                  {e.state === 'awaiting_president' && <p className="notice notice-info">Waiting for the president to publish this event.</p>}
                  {e.state === 'draft' && e.signoff?.reason && <p className="notice notice-error" role="status">Returned by the president: {e.signoff.reason}</p>}
                  {e.state === 'published' && !mayCancel && <p className="cs-hint">Only the president can cancel a published event.</p>}
                  <p>To reschedule, start a new request. Creating a new event does not cancel this event.</p>
                  {canManage && <Link to="/bookings/new" state={copyState}>Copy details to a new request</Link>}
                  {e.state !== 'cancelled' && canManage && mayCancel && (
                    confirming ? (
                      <form className="inline-confirm" onSubmit={cancel}>
                        <h2>Cancel this event?</h2>
                        <p>Cancellation affects the booking and every active registration. This can’t be undone.</p>
                        <TextField as="textarea" label="Reason" required maxLength={500} value={reason} onChange={x => setReason(x.target.value)} />
                        <div className="cs-row">
                          <Button variant="danger" type="submit" busy={action.busy} disabled={!reason.trim()}>Cancel event</Button>
                          <Button onClick={() => setConfirming(false)}>Keep event</Button>
                        </div>
                      </form>
                    ) : <div><Button variant="danger" onClick={() => setConfirming(true)}>Cancel event</Button></div>
                  )}
                </section>
              )}

              {tab === 'edit' && canManage && (
                e.state === 'cancelled' ? <p className="cs-meta">This event can’t be edited.</p> : closed ? (
                  // Returned and rejected requests are final (booking-approval spec):
                  // the way forward is a new request with these details (FLOW-02).
                  <section className="stack">
                    <p className="notice notice-info" role="status">
                      {e.booking.status === 'returned' ? 'The president returned this request' : 'The venue team rejected this request'}
                      {returnedReason ? `: ${returnedReason}` : '.'} It can’t be edited any more.
                    </p>
                    <p>Copy the details into a new request, make your changes there and send it again. This draft stays private.</p>
                    <div><ButtonLink variant="primary" to="/bookings/new" state={copyState}>Copy details to a new request</ButtonLink></div>
                  </section>
                ) : (
                  <form className="request-form" onSubmit={save}>
                    <h2 className="section-title">Edit event</h2>
                    {stale && (
                      <div className="notice notice-error" role="alert">
                        <p>This event was changed somewhere else after you started editing. Saving now would be refused.</p>
                        <Button onClick={loadLatest}>Load the latest version</Button>
                        <span className="cs-hint"> Your unsaved changes here will be replaced.</span>
                      </div>
                    )}
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
                    {e.state !== 'draft' && <p className="cs-hint">After publishing, the time, venue, capacity, visibility and registration deadline are fixed. You can still change the title, description, tags and cover.</p>}
                    {tags && <TagPicker clubId={e.club?.id} campus={tags.campus} club={tags.club} error={tagError} onCampus={campus => { setTags({ ...tags, campus }); setDirty(true); setTagError('') }} onClub={club => { setTags({ ...tags, club }); setDirty(true) }} />}
                    {e.state !== 'cancelled' && (
                      <CoverUploader title={e.title} current={e.cover} busy={action.busy} serverError={action.error?.fields?.file || (action.error && /cover|image|5 MB/i.test(action.error.message) ? action.error.message : '')} onSave={uploadCover} onRemove={removeCover} />
                    )}
                    <Feedback action={{ ...action, error: null }} />
                    <div className="step-actions"><Button variant="primary" type="submit" busy={action.busy}>Save changes</Button></div>
                  </form>
                )
              )}

              {tab === 'checkin' && e.state === 'published' && <CheckinPanel event={e} />}

              {tab === 'people' && canManage && e.visibility === 'members_only' && e.state === 'published' && (
                <JoinRequestsPanel event={e} onDecided={() => { event.refresh(); participants.refresh() }} />
              )}
              {tab === 'people' && canManage && (
                <section>
                  <h2 className="section-title">Participants</h2>
                  <TextField as="select" label="Filter" value={status} onChange={ev => { setStatus(ev.target.value); setPage(1) }}>
                    {['joined', 'waitlisted', 'left', 'cancelled'].map(x => <option key={x}>{x}</option>)}
                  </TextField>
                  <Resource value={participants} empty="No participants in this state.">
                    <div className="cs-tablewrap" role="region" aria-label="Participants" tabIndex={0}>
                      <table className="cs-table">
                        <thead><tr><th>Name</th><th>Email</th><th>Student ID</th><th>Status</th><th>Queue position</th></tr></thead>
                        <tbody>
                          {participants.data?.map(p => (
                            <tr key={p.user.id}>
                              <td>{p.user.name}</td>
                              <td>{p.user.email}</td><td>{p.user.student_id ?? '—'}</td>
                              <td>{p.status}</td>
                              <td>{p.queue_position ?? '—'}</td>
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
