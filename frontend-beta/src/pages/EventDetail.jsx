import { CalendarPlus, ChevronLeft, MapPin, CalendarDays, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { request } from '../api'
import { ErrorNotice, Resource } from '../components/common'
import { EventCover } from '../components/EventCard'
import { StickyActionBar } from '../components/StickyActionBar'
import { Button, ButtonLink, StatusChip, Sticker, TextField, isAlmostFull, useToast } from '../components/ui'
import { useAction, useResource } from '../hooks/resources'
import { eventChanged, useLiveSignal } from '../hooks/useLiveSignal'
import { usePhone } from '../hooks/useMediaQuery'
import { clubColour } from '../lib/club'
import { isOrganizer } from '../lib/roles'
import { dateTile, seatSummary, timeLine } from '../lib/format'
import { downloadIcs, icsFileName } from '../lib/ics'
import { registrationToast, registrationView } from '../lib/registration'

const SUCCESS_MS = 2000
const LEAVE_WORDS = {
  leave: { pending: 'Leaving this event in a few seconds.', done: 'You left the event.' },
  leave_waitlist: { pending: 'Leaving the waitlist in a few seconds.', done: 'You left the waitlist.' },
  cancel_request: { pending: 'Cancelling your request in a few seconds.', done: 'You cancelled your request.' },
}

export function EventDetail({ session }) {
  const { id } = useParams()
  const event = useResource(`/events/${id}`)
  const action = useAction(event.refresh)
  const toast = useToast()
  const phone = usePhone()
  const [going, setGoing] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const goingTimer = useRef(null)
  const refreshEvent = event.refresh
  const location = useLocation()
  const [checkingIn, setCheckingIn] = useState(false)
  const viewed = useRef(null)
  const source = location.state?.source ?? 'share'
  // Back to the list this page was opened from, filters included; same-site paths only.
  const back = location.state?.back
  const backTo = typeof back === 'string' && back.startsWith('/') && !back.startsWith('//') ? back : '/events'

  // Counts and queue position are advisory snapshots: refetch when the tab regains focus.
  useEffect(() => {
    window.addEventListener('focus', refreshEvent)
    return () => window.removeEventListener('focus', refreshEvent)
  }, [refreshEvent])
  // Seats, waitlist and state update live when anyone registers or leaves.
  useLiveSignal(eventChanged(id), refreshEvent)
  useEffect(() => () => clearTimeout(goingTimer.current), [])
  // One view per page open (the API also deduplicates per 30 minutes). Direct links count as shares.
  useEffect(() => {
    if (!event.data || viewed.current === id) return
    viewed.current = id
    request(`/events/${id}/views`, { method: 'POST', body: { source } }).catch(() => {})
  }, [id, event.data, source])

  const details = event.data
  const view = details ? registrationView(details) : null
  // After an outage (the event itself failed to load), the action's error goes
  // once Try again loads the event: the fresh page is the outcome (F12).
  const { error: actionError, reset: resetAction } = action
  const outage = useRef(false)
  useEffect(() => { if (event.error) outage.current = true }, [event.error])
  useEffect(() => {
    if (!details || !outage.current) return
    outage.current = false
    if (actionError) resetAction()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details])

  async function register() {
    const result = await action.run(`/events/${id}/registration`, 'POST', { allow_waitlist: Boolean(details.eligibility?.can_waitlist) })
    if (!result) return
    toast.show({ message: registrationToast(result.data) })
    if (result.data?.status === 'joined') {
      setGoing(true)
      clearTimeout(goingTimer.current)
      goingTimer.current = setTimeout(() => setGoing(false), SUCCESS_MS)
    }
  }

  // Leaving is undoable: the request goes out after the 5 second window, or
  // at once if the page is reloaded or closed first (F16, F14). The first
  // toast says what is about to happen; "You left…" only follows once the
  // server has confirmed it (REG-06, CLUB-09).
  function leave() {
    const words = LEAVE_WORDS[view.kind] ?? LEAVE_WORDS.leave
    setLeaving(true)
    toast.show({
      message: words.pending,
      tone: 'info',
      action: { label: 'Undo', onClick: () => setLeaving(false) },
      onExpire: async ({ unloading = false } = {}) => {
        if (unloading) {
          request(`/events/${id}/registration`, { method: 'DELETE', body: {}, keepalive: true }).catch(() => {})
          return
        }
        const result = await action.run(`/events/${id}/registration`, 'DELETE', {})
        setLeaving(false)
        if (result) toast.show({ message: words.done })
      },
    })
  }

  return (
    <main className="page event-page">
      <Resource value={event}>
        {details && (
          <EventBody
            details={details}
            view={view}
            phone={phone}
            going={going}
            leaving={leaving}
            busy={action.busy}
            error={action.error}
            onRegister={register}
            onLeave={leave}
            checkingIn={checkingIn}
            setCheckingIn={setCheckingIn}
            backTo={backTo}
            organizes={Boolean(session?.memberships?.some(item => item.club_id === details.club?.id && isOrganizer(item)))}
          />
        )}
      </Resource>
    </main>
  )
}

// Descriptions are plain text: blank lines separate paragraphs and lines that
// start with "- " become list items. React escapes everything.
function Description({ text }) {
  const blocks = String(text ?? '').replace(/\r\n?/g, '\n').split(/\n{2,}/).map(block => block.trim()).filter(Boolean)
  return blocks.map((block, index) => {
    const lines = block.split('\n')
    const isItem = line => /^\s*-\s+/.test(line)
    const items = lines.filter(isItem)
    if (items.length === 0) return <p key={index}>{block}</p>
    const lead = lines.filter(line => !isItem(line)).join('\n')
    return (
      <div key={index} className="event-about-block">
        {lead && <p>{lead}</p>}
        <ul>{items.map((line, i) => <li key={i}>{line.replace(/^\s*-\s+/, '')}</li>)}</ul>
      </div>
    )
  })
}

function checkinOpen(details, now = Date.now()) {
  return now >= new Date(details.start_at).getTime() - 30 * 60_000 && now <= new Date(details.end_at).getTime() + 2 * 3_600_000
}

function CheckinForm({ id, onDone }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await request(`/events/${id}/attendance`, { method: 'POST', body: { code } })
      toast.show({ message: 'You’re checked in. Enjoy!' })
      onDone()
    } catch (failure) {
      setError(failure.fields?.code || failure.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="checkin-form" onSubmit={submit}>
      <TextField label="Check-in code" hint="The 4 digits the organizers are showing." name="code" inputMode="numeric" autoComplete="off" maxLength={4} pattern="[0-9]{4}" value={code} error={error} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} />
      <Button variant="primary" type="submit" busy={busy} disabled={code.length !== 4}>Check in</Button>
    </form>
  )
}

function PrimaryAction({ view, going, leaving, busy, onRegister, onLeave, details, checkin, onCheckin, onCalendar }) {
  if (leaving) return <Button disabled busy>{view.kind === 'cancel_request' ? 'Cancelling…' : 'Leaving…'}</Button>
  if (going) return <Button variant="success" disabled>You’re going!</Button>
  if (checkin) return <Button variant="primary" onClick={onCheckin}>Check in</Button>
  switch (view.kind) {
    case 'join':
    case 'waitlist':
      return <Button variant="primary" busy={busy} onClick={onRegister}>{busy ? (view.approval ? 'Sending request…' : view.kind === 'join' ? 'Joining…' : 'Joining waitlist…') : view.label}</Button>
    case 'join_club':
      return <ButtonLink variant="primary" to="/clubs">{view.label}</ButtonLink>
    case 'admin':
      return <ButtonLink to={`/organizer/events/${details.id}`}>{view.label}</ButtonLink>
    case 'leave':
      return <Button onClick={() => onCalendar(details)}><CalendarPlus className="cs-icon" aria-hidden="true" />Add to calendar</Button>
    case 'leave_waitlist':
    case 'cancel_request':
      return <Button onClick={onLeave}>{view.label}</Button>
    default:
      return <Button disabled>{view.label}</Button>
  }
}

function EventBody({ details, view, phone, going, leaving, busy, error, onRegister, onLeave, checkingIn, setCheckingIn, backTo, organizes }) {
  const toast = useToast()
  // The download happens silently in most browsers, so say where it went (DISC-09).
  const onCalendar = event => {
    downloadIcs(event)
    toast.show({ message: `Calendar file downloaded (${icsFileName(event)}). Open it to add the event.` })
  }
  const canCheckIn = view.kind === 'leave' && details.state === 'published' && checkinOpen(details)
  const colour = clubColour(details.club?.id)
  const tile = dateTile(details.start_at)
  const seats = seatSummary(details)
  const hot = isAlmostFull(details.joined_count, details.capacity)
  const full = details.joined_count >= details.capacity
  const cover = details.cover
  const sticker = details.state === 'cancelled' ? null
    : details.visibility === 'members_only' ? null
    : hot ? <Sticker tone="coral">Almost full</Sticker> : null

  const info = leaving ? <b>Leaving…</b>
    : going ? <b>You’re going!</b>
    : view.chip === 'joined' ? <StatusChip state="joined" />
    : view.chip === 'waitlisted' ? <StatusChip state="waitlisted" position={view.position} />
    : <><b>{view.headline}</b>{view.detail && <span>{view.detail}</span>}</>

  return (
    <div className="event-article" style={{ '--club': colour.cssVar }}>
      <div className="event-hero">
        {cover ? (
          <div className="cs-cover event-cover">
            <span className="event-cover-frame">
              <img className="event-cover-photo" src={cover.full_url} width="1200" height="800" alt={cover.alt} />
              <img className="event-cover-bg" src={cover.full_url} alt="" aria-hidden="true" decoding="async" />
            </span>
            <time className="cs-datetile event-tile" dateTime={tile.iso}><small>{tile.month}</small><b>{tile.day}</b></time>
          </div>
        ) : (
          <EventCover event={details} eager>
            {sticker}
            <time className="cs-datetile event-tile" dateTime={tile.iso}><small>{tile.month}</small><b>{tile.day}</b></time>
          </EventCover>
        )}
        <Link className="cs-iconbtn event-back" to={backTo} aria-label="Back to events"><ChevronLeft className="cs-icon" aria-hidden="true" /></Link>
      </div>

      <div className="event-layout">
        <div className="event-main">
          <span className="cs-club"><i aria-hidden="true" /><span>{details.club?.name}</span></span>
          <h1 className="event-title">{details.title}</h1>
          <div className="cs-row">
            {details.visibility === 'members_only' ? <StatusChip state="members_only" /> : <span className="cs-chip cs-chip-neutral">Open to everyone</span>}
            {details.state === 'cancelled' && <StatusChip state="cancelled" />}
            {hot && <span className="cs-chip cs-chip-hot">Almost full</span>}
          </div>

          {(details.campus_tags?.length > 0 || details.club_tags?.length > 0) && (
            <section className="event-tags">
              <h2 className="event-tags-title" id="event-tags-title">Tags</h2>
              <ul className="tag-list" aria-labelledby="event-tags-title">
                {details.campus_tags?.map(tag => <li key={`c${tag.id}`} className="is-campus">{tag.name}</li>)}
                {details.club_tags?.map(tag => <li key={`k${tag.id}`} className="is-club">{tag.name}</li>)}
              </ul>
            </section>
          )}

          <dl className="event-facts">
            <CalendarDays className="cs-icon" aria-hidden="true" />
            <div><dt className="cs-sr">When</dt><dd className="fact-main">{timeLine(details.start_at, details.end_at)}</dd><dd className="cs-hint">Hong Kong time</dd></div>
            <MapPin className="cs-icon" aria-hidden="true" />
            <div><dt className="cs-sr">Where</dt><dd className="fact-main">{details.venue?.name}</dd>{details.venue?.location && <dd className="cs-hint">{details.venue.location}</dd>}</div>
          </dl>

          <div className="cs-meter">
            <div className="cs-meter-track" role="presentation"><div className={`cs-meter-fill${full ? ' is-full' : hot ? ' is-hot' : ''}`} style={{ width: `${Math.round(seats.ratio * 100)}%` }} /></div>
            <div className="cs-meter-caption"><span>{seats.joined}</span><span>{details.waitlisted_count > 0 ? `${details.waitlisted_count} waiting` : seats.caption}</span></div>
          </div>

          {/* The club's committee and president jump to who has joined or quit. */}
          {organizes && (
            <div className="event-organizer-tools">
              <ButtonLink to={`/organizer/events/${details.id}?tab=people`}>
                <Users className="cs-icon" aria-hidden="true" />See who's joining
              </ButtonLink>
            </div>
          )}

          <section className="event-about">
            <h2>About this event</h2>
            <Description text={details.description} />
          </section>
        </div>

        <aside className="event-side" aria-label="Registration">
          <div className={`registration-card${leaving ? ' is-leaving' : ''}`}>
            <h2 className="section-title">Registration</h2>
            <p className="registration-headline">{leaving ? 'Leaving…' : going ? 'You’re going!' : view.headline}</p>
            {view.detail && !leaving && <p className="cs-meta">{view.detail}</p>}
            <ErrorNotice error={error} />
            {!phone && (
              <div className="cs-col registration-actions">
                <PrimaryAction view={view} going={going} leaving={leaving} busy={busy} onRegister={onRegister} onLeave={onLeave} details={details} checkin={canCheckIn} onCheckin={() => setCheckingIn(true)} onCalendar={onCalendar} />
                {view.kind === 'leave' && !leaving && <Button onClick={onLeave}>{view.label}</Button>}
              </div>
            )}
            {checkingIn && canCheckIn && <CheckinForm id={details.id} onDone={() => setCheckingIn(false)} />}
            {phone && view.kind === 'leave' && !leaving && <Button onClick={onLeave}>{view.label}</Button>}
          </div>
        </aside>
      </div>

      {phone && (
        <StickyActionBar info={info}>
          <PrimaryAction view={view} going={going} leaving={leaving} busy={busy} onRegister={onRegister} onLeave={onLeave} details={details} checkin={canCheckIn} onCheckin={() => setCheckingIn(true)} onCalendar={onCalendar} />
        </StickyActionBar>
      )}
    </div>
  )
}
