import { CircleAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { addDays, campusDate, campusInstant, query, request } from '../api'
import { CoverUploader } from '../components/CoverUploader'
import { TagPicker } from '../components/TagPicker'
import { coverForm } from '../lib/cover'
import { ErrorNotice, PageHeading, Resource } from '../components/common'
import { SlotPicker } from '../components/SlotPicker'
import { Button, TextField, useToast } from '../components/ui'
import { useAction, useAllOptions, useResource } from '../hooks/resources'
import { dayLabel } from '../lib/format'
import { isOrganizer } from '../lib/roles'
import { buildWeek, defaultDay, slotLabel, weekWindow } from '../lib/slots'

const STEPS = [
  { id: 'venue', label: 'Venue and time' },
  { id: 'details', label: 'Event details' },
  { id: 'review', label: 'Review' },
]
const CONFLICT = 'That slot was just booked. Pick another time.'

// Venue request in three steps. Step, venue, week, day and slot live in the URL
// (?step=details&venue_id=1&week=2026-11-09&date=2026-11-12&slot_id=morning) so a
// refresh or a shared link returns to the same place. Other fields stay in the
// form when a step changes or the server answers 409.
export function CreateEvent({ session }) {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToast()
  const copy = location.state?.copyEvent
  const venues = useAllOptions('/venues')
  const config = useResource('/config')
  const clubs = session.memberships.filter(isOrganizer)
  const action = useAction()
  const formRef = useRef(null)
  const [tick, setTick] = useState(0)
  const [conflict, setConflict] = useState('')
  const [errors, setErrors] = useState({})
  const [cover, setCover] = useState(null)
  const [tags, setTags] = useState({ campus: [], club: [] })
  const [form, setForm] = useState({
    club_id: copy?.club_id ? String(copy.club_id) : clubs.length === 1 ? String(clubs[0].club_id) : '',
    title: copy?.title || '',
    description: copy?.description || '',
    visibility: copy?.visibility || 'public',
    capacity: copy?.capacity ? String(copy.capacity) : '',
    registration_closes_at: '',
  })

  const step = STEPS.some(item => item.id === params.get('step')) ? params.get('step') : 'venue'
  const venueId = params.get('venue_id') || (copy?.venue_id ? String(copy.venue_id) : '')
  const date = params.get('date') || ''
  const slotId = params.get('slot_id') || params.get('slot') || ''
  const today = campusDate(new Date())
  const anchor = params.get('week') || date || today
  const window_ = weekWindow(anchor)
  const venue = venues.data?.find(item => String(item.id) === venueId)
  const slot = config.data?.slots.find(item => item.id === slotId)

  const calendar = useResource(venueId && config.data
    ? `/venues/${venueId}/calendar${query({ from: window_.from, to: window_.to })}`
    : null)
  const bookings = calendar.data?.bookings
  const days = useMemo(
    () => (config.data && bookings ? buildWeek(window_.start, config.data.slots, bookings) : null),
    // `tick` re-evaluates "now" when the calendar is refreshed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.data, bookings, window_.start, tick],
  )

  // Update some URL parameters, keeping the rest.
  function patch(values, { replace = false } = {}) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    next.delete('slot')
    setParams(next, { replace })
  }

  // Choosing a venue or day starts on the first day with free slots.
  useEffect(() => {
    if (days && !date) patch({ date: defaultDay(days) }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days])

  const update = event => {
    const { name, value } = event.target
    setForm(current => ({ ...current, [name]: value }))
    setErrors(current => ({ ...current, [name]: undefined }))
  }

  function goTo(next) { patch({ step: next === 'venue' ? '' : next }) }

  function validateVenue() {
    const found = {}
    if (!form.club_id) found.club_id = 'Choose the club that is hosting.'
    if (!venueId) found.venue_id = 'Choose a venue.'
    if (!date || !slotId) found.slot = 'Pick an available slot.'
    return found
  }

  function validateDetails() {
    const found = {}
    if (!form.title.trim()) found.title = 'Give the event a title.'
    if (!form.description.trim()) found.description = 'Say what people will do.'
    const capacity = Number(form.capacity)
    const limit = Math.min(500, venue?.capacity ?? 500)
    if (!Number.isInteger(capacity) || capacity < 1) found.capacity = 'Enter a whole number of 1 or more.'
    else if (capacity > limit) found.capacity = `${venue?.name || 'This venue'} holds up to ${limit} people. Enter ${limit} or fewer.`
    if (form.registration_closes_at && slot && new Date(campusInstant(form.registration_closes_at.slice(0, 10), form.registration_closes_at.slice(11, 16))) > new Date(campusInstant(date, slot.start))) {
      found.registration_closes_at = 'Registration must close before the event starts.'
    }
    return found
  }

  function advance(from, to) {
    const found = from === 'venue' ? validateVenue() : validateDetails()
    setErrors(found)
    if (Object.keys(found).length) {
      // Move focus to the first invalid field.
      requestAnimationFrame(() => formRef.current?.querySelector('[aria-invalid="true"], .is-invalid button, .slot-picker .cs-slot')?.focus())
      return
    }
    setConflict('')
    goTo(to)
  }

  async function submit(event) {
    event.preventDefault()
    const body = {
      club_id: Number(form.club_id), venue_id: Number(venueId), title: form.title.trim(), description: form.description.trim(),
      date, slot_id: slotId, visibility: form.visibility, capacity: Number(form.capacity),
    }
    if (form.registration_closes_at) body.registration_closes_at = campusInstant(form.registration_closes_at.slice(0, 10), form.registration_closes_at.slice(11, 16))
    if (tags.campus.length) body.campus_tag_ids = tags.campus
    if (tags.club.length) body.club_tag_ids = tags.club
    const result = await action.run('/events', 'POST', body)
    if (result) {
      if (cover) {
        try {
          await request(`/events/${result.data.id}/cover`, { method: 'PUT', body: coverForm({ file: cover.file, alt: cover.alt, expectedVersion: result.data.version ?? 1 }) })
        } catch (error) {
          toast.show({ message: `Request sent, but the cover wasn’t uploaded: ${error.message} Add it from Manage event.`, tone: 'error' })
          navigate(`/organizer/events/${result.data.id}?tab=edit`, { state: { created: true } })
          return
        }
      }
      toast.show({ message: 'Request sent. We’ll let you know when it’s reviewed.' })
      navigate(`/organizer/events/${result.data.id}`, { state: { created: true } })
    }
  }

  // The server's 409 is authoritative: show it above the slots, refresh them,
  // and keep every other field.
  useEffect(() => {
    if (action.error?.status === 409 && (action.error.code === 'VENUE_UNAVAILABLE' || /venue|slot/i.test(action.error.message))) {
      setConflict(CONFLICT)
      calendar.refresh()
      setTick(value => value + 1)
      patch({ step: '', slot_id: '' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action.error])

  const stepIndex = STEPS.findIndex(item => item.id === step)
  const selected = { date, slot_id: slotId }
  const clubName = clubs.find(item => String(item.club_id) === form.club_id)?.club_name || clubs.find(item => String(item.club_id) === form.club_id)?.name

  return (
    <main className="page request-page">
      <PageHeading
        title="Request a venue for an event"
        description="Approval and publication are separate. Times are Hong Kong time."
      />
      {copy && <p className="notice notice-info">Details copied. Choose a new date and time. The original event remains unchanged.</p>}
      {!clubs.length && <p className="notice notice-error" role="alert">Committee or president membership is required.</p>}

      <ol className="cs-steps" aria-label="Request progress">
        {STEPS.map((item, index) => (
          <li key={item.id} className={`cs-step${index < stepIndex ? ' is-done' : ''}${index === stepIndex ? ' is-current' : ''}`} aria-current={index === stepIndex ? 'step' : undefined}>
            <span className="cs-step-dot" aria-hidden="true">{index < stepIndex ? '✓' : index + 1}</span>{item.label}
          </li>
        ))}
      </ol>

      <Resource value={venues}><Resource value={config}>
        <form ref={formRef} className="request-form" onSubmit={submit} noValidate>
          <section hidden={step !== 'venue'} aria-labelledby="step-venue">
            <h2 id="step-venue" className="section-title">Venue and time</h2>
            <TextField as="select" label="Club" name="club_id" value={form.club_id} error={errors.club_id} onChange={update}>
              <option value="">Select club</option>
              {clubs.map(club => <option key={club.club_id} value={club.club_id}>{club.club_name || club.name}</option>)}
            </TextField>
            <TextField
              as="select" label="Venue" name="venue_id" value={venueId} error={errors.venue_id}
              onChange={event => { patch({ venue_id: event.target.value, date: '', slot_id: '', week: '' }); setErrors(current => ({ ...current, venue_id: undefined })) }}
            >
              <option value="">Select venue</option>
              {venues.data?.filter(item => item.is_active).map(item => <option key={item.id} value={item.id}>{item.name} (capacity {item.capacity})</option>)}
            </TextField>

            {venueId && (
              <div className="slot-region">
                <Resource value={calendar} allowEmpty>
                  {days && (
                    <SlotPicker
                      venueName={venue?.name || 'Venue'}
                      weekStartDate={window_.start}
                      days={days}
                      selected={selected}
                      loading={calendar.loading}
                      canGoBack={window_.start > weekWindow(today).start}
                      notice={conflict && <p role="alert" className="notice notice-error"><CircleAlert className="cs-icon" aria-hidden="true" /><span>{conflict}</span></p>}
                      onWeek={delta => patch({ week: addDays(window_.start, delta * 7), date: '', slot_id: '' })}
                      onDay={next => patch({ date: next, slot_id: '' })}
                      onSelect={(nextDate, nextSlot) => { setConflict(''); setErrors(current => ({ ...current, slot: undefined })); patch({ date: nextDate, slot_id: nextSlot }) }}
                    />
                  )}
                </Resource>
                {errors.slot && <span className="cs-error"><CircleAlert className="cs-icon" aria-hidden="true" />{errors.slot}</span>}
              </div>
            )}
            {date && slot && venue && (
              <p className="selected-slot" role="status">
                <strong>{venue.name}</strong> · {dayLabel(campusInstant(date, slot.start))} · {slotLabel(slot)} Hong Kong time
              </p>
            )}
            <div className="step-actions">
              <Button variant="primary" disabled={!clubs.length} onClick={() => advance('venue', 'details')}>Next: event details</Button>
            </div>
          </section>

          <section hidden={step !== 'details'} aria-labelledby="step-details">
            <h2 id="step-details" className="section-title">Event details</h2>
            <TextField label="Title" name="title" autoComplete="off" required maxLength={255} value={form.title} error={errors.title} onChange={update} />
            <TextField as="textarea" label="Description" name="description" autoComplete="off" required maxLength={10000} rows={5} value={form.description} error={errors.description} onChange={update} />
            <TextField as="select" label="Visibility" name="visibility" value={form.visibility} onChange={update}>
              <option value="public">Public</option>
              <option value="members_only">Members only</option>
            </TextField>
            <TextField label="Capacity" name="capacity" type="number" inputMode="numeric" min="1" max="500" autoComplete="off" value={form.capacity} error={errors.capacity} hint={venue ? `${venue.name} holds up to ${venue.capacity}.` : undefined} onChange={update} />
            <TextField label="Registration deadline (Hong Kong time)" optional name="registration_closes_at" type="datetime-local" value={form.registration_closes_at} error={errors.registration_closes_at} hint="Leave empty to close registration when the event starts." onChange={update} />
            <TagPicker clubId={form.club_id} campus={tags.campus} club={tags.club} onCampus={campus => setTags({ ...tags, campus })} onClub={club => setTags({ ...tags, club })} />
            <CoverUploader title={form.title} onChange={setCover} />
            <div className="step-actions">
              <Button onClick={() => goTo('venue')}>Back</Button>
              <Button variant="primary" onClick={() => advance('details', 'review')}>Next: review</Button>
            </div>
          </section>

          <section hidden={step !== 'review'} aria-labelledby="step-review">
            <h2 id="step-review" className="section-title">Review</h2>
            <dl className="review-list">
              <div><dt>Club</dt><dd>{clubName}</dd></div>
              <div><dt>Venue and time</dt><dd>{venue?.name} · {date && slot ? `${dayLabel(campusInstant(date, slot.start))} · ${slotLabel(slot)}` : ''} Hong Kong time</dd></div>
              <div><dt>Title</dt><dd>{form.title}</dd></div>
              <div><dt>Description</dt><dd className="pre">{form.description}</dd></div>
              {cover && <div><dt>Cover</dt><dd>{cover.file.name}</dd></div>}
              <div><dt>Who can join</dt><dd>{form.visibility === 'members_only' ? 'Members only' : 'Open to everyone'}</dd></div>
              <div><dt>Capacity</dt><dd>{form.capacity}</dd></div>
            </dl>
            <p className="cs-meta">Your request goes to a venue administrator. The event stays a draft until you publish it.</p>
            {action.error && !conflict && <ErrorNotice error={action.error} />}
            <div className="step-actions">
              <Button onClick={() => goTo('details')}>Back</Button>
              <Button variant="primary" type="submit" busy={action.busy} disabled={!clubs.length}>{action.busy ? 'Sending…' : 'Submit request'}</Button>
            </div>
          </section>
        </form>
      </Resource></Resource>
    </main>
  )
}
