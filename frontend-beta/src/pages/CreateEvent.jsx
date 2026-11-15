import { useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { campusInstant, usesMainBackend } from '../api'
import { isOrganizer } from '../lib/roles'
import { Resource, Feedback } from '../components/common'
import { useResource, useAllOptions, useAction } from '../hooks/resources'

export function CreateEvent({ session }) {
  const [params] = useSearchParams()
  const location = useLocation()
  const copy = location.state?.copyEvent
  const venues = useAllOptions('/venues')
  const config = useResource('/config')
  const clubs = session.memberships.filter(isOrganizer)
  const [form, setForm] = useState({ club_id: copy?.club_id ? String(copy.club_id) : '', venue_id: params.get('venue_id') || (copy?.venue_id ? String(copy.venue_id) : ''), title: copy?.title || '', description: copy?.description || '', date: params.get('date') || '', slot_id: params.get('slot_id') || '', visibility: copy?.visibility || 'public', capacity: copy?.capacity ? String(copy.capacity) : '', registration_closes_at: '' })
  const action = useAction()
  const navigate = useNavigate()
  const selectedVenue = venues.data?.find(venue => String(venue.id) === form.venue_id)
  const selectedSlot = config.data?.slots.find(slot => slot.id === form.slot_id)
  function update(event) { setForm(current => ({ ...current, [event.target.name]: event.target.value })) }
  async function submit(event) {
    event.preventDefault()
    const body = { ...form, club_id: Number(form.club_id), venue_id: Number(form.venue_id), capacity: Number(form.capacity) }
    if (body.registration_closes_at) body.registration_closes_at = campusInstant(body.registration_closes_at.slice(0, 10), body.registration_closes_at.slice(11, 16))
    else delete body.registration_closes_at
    const result = await action.run('/events', 'POST', body)
    if (result) navigate(`/organizer/events/${result.data.id}`, { state: { created: true } })
  }
  return <main><h1>{usesMainBackend ? 'Book a venue for an event' : 'Request a venue for an event'}</h1><p>{usesMainBackend ? 'Booking a venue publishes the event immediately.' : 'Approval and publication are separate.'} Times are Hong Kong time.</p>
    {copy && <p>Details copied. Choose a new date and time. The original event remains unchanged.</p>}
    {!clubs.length && <p>Committee or president membership is required.</p>}
    <Resource value={venues}><Resource value={config}>
      <section className="panel"><h2>Selected venue and time</h2><p>{selectedVenue?.name || 'Choose a venue'} · {form.date || 'Choose a date'} · {selectedSlot ? `${selectedSlot.start}–${selectedSlot.end}` : 'Choose a slot'} Hong Kong time</p></section>
      <form className="panel stack" onSubmit={submit}>
        <fieldset><legend>Venue and time</legend>
          <label>Club<select name="club_id" required value={form.club_id} onChange={update}><option value="">Select club</option>{clubs.map(club => <option key={club.club_id} value={club.club_id}>{club.club_name}</option>)}</select></label>
          <label>Venue<select name="venue_id" required value={form.venue_id} onChange={update}><option value="">Select venue</option>{venues.data?.filter(venue => venue.is_active).map(venue => <option key={venue.id} value={venue.id}>{venue.name} (capacity {venue.capacity})</option>)}</select></label>
          <label>Date<input name="date" type="date" required value={form.date} onChange={update}/></label>
          <label>Slot<select name="slot_id" required value={form.slot_id} onChange={update}><option value="">Select slot</option>{config.data?.slots.map(slot => <option key={slot.id} value={slot.id}>{slot.start}–{slot.end}</option>)}</select></label>
        </fieldset>
        <fieldset><legend>Event details</legend>
          <label>Title<input name="title" required maxLength={255} value={form.title} onChange={update}/></label>
          <label>Description<textarea name="description" required maxLength={10000} value={form.description} onChange={update}/></label>
          <label>Visibility<select name="visibility" value={form.visibility} onChange={update}><option value="public">Public</option><option value="members_only">Members only</option></select></label>
          {usesMainBackend ? <p>Event capacity follows the selected venue.</p> : <><label>Capacity<input name="capacity" type="number" min="1" max="500" required value={form.capacity} onChange={update}/></label>
          <label>Registration deadline (Hong Kong time; optional)<input name="registration_closes_at" type="datetime-local" value={form.registration_closes_at} onChange={update}/></label></>}
        </fieldset><Feedback action={action}/><button disabled={action.busy || !clubs.length}>{usesMainBackend ? 'Book venue and publish' : 'Submit request'}</button>
      </form>
    </Resource></Resource>
  </main>
}
