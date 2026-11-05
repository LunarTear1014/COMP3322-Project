import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { request, setCsrf, query, campusTime, campusDate, campusInstant, addDays, weekStart, slotAvailability, usesMainBackend } from './api'
const ReportFigures = lazy(() => import('./ReportFigures'))
import './App.css'

const isOrganizer = membership => membership.role === 'committee' || membership.role === 'president'

function PageHeading({ title, description }) {
  return <div className="page-heading"><h1>{title}</h1>{description && <p>{description}</p>}</div>
}

function ErrorNotice({ error }) { return error && <div role="alert" className="error">{error.message} {error.retryAfter && `Try again after ${error.retryAfter} seconds.`}{Object.entries(error.fields || {}).map(([k,v]) => <p key={k}>{k}: {v}</p>)}</div> }
function useResource(path) {
  const [state, setState] = useState({ path: null, loading: true })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!path) return
    const controller = new AbortController()
    setState(previous => previous.path === path ? { ...previous, loading: true, error: null } : { path, loading: true })
    request(path, { signal: controller.signal })
      .then(result => setState({ ...result, path, loading: false }))
      .catch(error => { if (error.name !== 'AbortError') setState({ path, error, loading: false }) })
    return () => controller.abort()
  }, [path, tick])
  const refresh = useCallback(() => setTick(current => current + 1), [])
  const visible = state.path === path ? state : { loading: Boolean(path) }
  return { ...visible, refresh }
}
function useAllOptions(path) {
  const [state, setState] = useState({ loading: true })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        setState(previous => ({ ...previous, loading: true, error: null }))
        const items = []
        let page = 1
        while (true) {
          const result = await request(`${path}?page=${page}&page_size=100`, { signal: controller.signal })
          items.push(...result.data)
          if (items.length >= result.meta.total) break
          if (!result.data.length || result.meta.page !== page) throw new Error('Could not load all filter options.')
          page += 1
        }
        setState({ data: items, loading: false })
      } catch (error) {
        if (error.name !== 'AbortError') setState({ error, loading: false })
      }
    }
    load()
    return () => controller.abort()
  }, [path, tick])
  const refresh = useCallback(() => setTick(current => current + 1), [])
  return { ...state, refresh }
}
function Resource({ value, children, empty = 'Nothing to show.', allowEmpty = false }) { return <><ErrorNotice error={value.error}/>{value.error && <button className="secondary-button" onClick={value.refresh}>Try again</button>}{value.loading && <p role="status">{value.data ? 'Refreshing…' : 'Loading…'}</p>}{value.data && (Array.isArray(value.data) && !value.data.length && !allowEmpty ? <p>{empty}</p> : children)}</> }
function Pagination({ meta, page, setPage }) { return meta && meta.total > meta.page_size && <div className="row"><button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {meta.page} · {meta.total} total</span><button disabled={meta.page * meta.page_size >= meta.total} onClick={() => setPage(page + 1)}>Next</button></div> }
function useAction(refresh) { const [error, setError] = useState(null); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); async function run(path, method, body, success) { setBusy(true); setError(null); setMessage(''); try { const result = await request(path, { method, body }); setMessage(success || 'Saved.'); refresh?.(); return result } catch (e) { setError(e); if (e.status === 409 || e.status === 0 || e.code === 'INVALID_RESPONSE') refresh?.(); return null } finally { setBusy(false) } } return { run, error, busy, message } }
function Feedback({ action }) { return <><ErrorNotice error={action.error}/>{action.message && <p role="status">{action.message}</p>}</> }
function AuthForm({ mode, onLogin }) { const navigate = useNavigate(); const location = useLocation(); const [form, setForm] = useState({ name: '', email: '', student_id: '', password: '', confirm_password: '' }); const action = useAction(); const register = mode === 'register'; async function submit(e) { e.preventDefault(); const { confirm_password, ...registration } = form; const body = register ? (usesMainBackend ? { ...registration, confirm_password } : registration) : { email: form.email, password: form.password }; const result = await action.run(`/auth/${mode}`, 'POST', body, register ? 'Account created. Please sign in.' : 'Signed in.'); if (result && (!register || usesMainBackend)) { setCsrf(result.data.csrf_token); onLogin(result.data); const target = new URLSearchParams(location.search).get('return'); navigate(target?.startsWith('/') && !target.startsWith('//') ? target : '/events', { replace: true }) } }
  return <main className="auth-page"><div className="auth-brand"><span className="brand-mark" aria-hidden="true">C<span>✳</span></span><span>ClubSpace<small>YOUR CAMPUS, CONNECTED</small></span></div>{import.meta.env.MODE === 'fixtures' && <div className="preview-banner" role="status">Local preview · Sample data · Read-only</div>}<div className="auth-layout"><section className="auth-card"><h1>{register ? 'Create your account' : 'Welcome back'}</h1><p className="auth-subtitle">{register ? 'Join your campus community to get started.' : 'Sign in to find your people and your next event.'}</p>{import.meta.env.MODE === 'fixtures' && !register && <details className="preview-credentials"><summary>Local preview credentials</summary><p>preview@clubspace.test<br/>preview12345</p></details>}<form onSubmit={submit} className="auth-form stack">{register && <><label>Name<input required maxLength={100} value={form.name} onChange={e => setForm({...form,name:e.target.value})}/></label><label>Student ID<input required value={form.student_id} onChange={e => setForm({...form,student_id:e.target.value})}/></label></>}<label>Email<input type="email" required value={form.email} onChange={e => setForm({...form,email:e.target.value})}/></label><label>Password<input type="password" required minLength={register ? (usesMainBackend ? 8 : 12) : 1} maxLength={128} value={form.password} onChange={e => setForm({...form,password:e.target.value})}/></label>{register && usesMainBackend && <label>Confirm password<input type="password" required value={form.confirm_password} onChange={e => setForm({...form,confirm_password:e.target.value})}/></label>}<Feedback action={action}/><button disabled={action.busy}>{register ? 'Register' : 'Sign in'}</button><p className="auth-switch">{register ? 'Already have an account? ' : 'New to ClubSpace? '}<Link to={register ? '/login' : '/register'}>{register ? 'Sign in' : 'Create an account'}</Link></p></form></section><section className="auth-intro"><h2>Good things happen <em>together.</em></h2><p>Find your community, discover what’s happening, and bring your next great idea to campus.</p><div className="intro-detail"><span aria-hidden="true">✳</span><div><strong>One place for your campus</strong><br/>Events, clubs, and spaces, all together.</div></div></section></div><footer className="auth-footer">Made for campus communities <span>✳</span> ClubSpace</footer></main> }
function Shell() { const [session, setSession] = useState(null); const [menuOpen, setMenuOpen] = useState(false); const [boot, setBoot] = useState(true); const [bootError, setBootError] = useState(null); const [unread, setUnread] = useState(0); const location = useLocation(); const navigate = useNavigate(); const refreshSession = useCallback(async () => { try { const result = await request('/auth/session'); setCsrf(result.data.csrf_token); setSession(result.data); setBootError(null) } catch(e) { if (e.status === 401) { setSession(null); setCsrf(null) } else setBootError(e) } finally { setBoot(false) } }, []); useEffect(() => { refreshSession(); const expired = () => { setSession(null); setCsrf(null) }; window.addEventListener('clubspace:unauthorized', expired); return () => window.removeEventListener('clubspace:unauthorized', expired) }, [refreshSession]); const refreshInbox = useCallback(async () => { if (!session || document.hidden) return; try { const r = await request('/notifications?page=1&page_size=1'); setUnread(r.meta?.unread_count ?? 0) } catch { /* inbox page displays errors */ } }, [session]); useEffect(() => { if (!session) return; refreshInbox(); const id = setInterval(refreshInbox, 30000); const focus = () => { if (!document.hidden) refreshInbox() }; window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus); return () => { clearInterval(id); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus) } }, [session, refreshInbox]); async function logout() { try { await request('/auth/logout', {method:'POST'}) } catch(e) { if (e.status !== 401) { setBootError(e); return } } setCsrf(null); setSession(null); navigate('/login') }
  if (boot) return <main><p role="status">Loading session…</p></main>; if (bootError && !session) return <main><ErrorNotice error={bootError}/><button onClick={refreshSession}>Retry session</button></main>; const publicPage = location.pathname === '/login' || location.pathname === '/register'; if (!session && !publicPage) return <Navigate to={`/login?return=${encodeURIComponent(location.pathname + location.search)}`} replace/>; if (!session) return <AuthForm key={location.pathname} mode={location.pathname.slice(1)} onLogin={setSession}/>;
  return <>{import.meta.env.MODE === 'fixtures' && <div className="preview-banner" role="status">Local preview · Sample data · Read-only</div>}<header className="site-header"><div className="header-inner"><Link className="brand" to="/events"><span className="brand-mark" aria-hidden="true">C<span>✳</span></span><span>ClubSpace<small>CAMPUS COMMUNITY</small></span></Link><div className={`navigation-menu ${menuOpen ? "is-open" : ""}`}><button className="menu-toggle" aria-expanded={menuOpen} aria-controls="main-navigation" onClick={() => setMenuOpen(!menuOpen)}>Menu · {location.pathname.startsWith('/me/') ? 'My registrations' : ({events:'Events',venues:'Venues',organizer:'Organizer',admin:'Admin',notifications:'Notifications',profile:'Profile',bookings:'Venue request'}[location.pathname.split('/')[1]] || 'Events')}</button><nav id="main-navigation" aria-label="Main navigation" onClick={event => { if (event.target.closest('a')) { if (menuOpen) event.currentTarget.parentElement.querySelector('.menu-toggle').focus(); setMenuOpen(false) } }} onKeyDown={event => { if (event.key !== 'Escape') return; const account = event.target.closest('.account-menu'); if (account?.open) { account.open = false; account.querySelector('summary').focus(); return } if (menuOpen) { setMenuOpen(false); event.currentTarget.parentElement.querySelector('.menu-toggle').focus() } }}><NavLink to="/events">Events</NavLink><NavLink to="/venues">Venues</NavLink><NavLink to="/me/registrations">My registrations</NavLink>{session.memberships.some(isOrganizer) && <NavLink to="/organizer">Organizer</NavLink>}{session.user.platform_role === 'venue_admin' && <NavLink to="/admin/bookings">Admin</NavLink>}<NavLink to="/notifications">Notifications <span className="unread-count">{unread}</span></NavLink><details className="account-menu"><summary>Account</summary><div><NavLink to="/profile">Profile</NavLink><button className="sign-out" onClick={logout}>Sign out</button></div></details></nav></div></div></header><ErrorNotice error={bootError}/><Routes><Route path="/" element={<Navigate to="/events" replace/>}/><Route path="/login" element={<Navigate to="/events" replace/>}/><Route path="/register" element={<Navigate to="/events" replace/>}/><Route path="/events" element={<Events/>}/><Route path="/events/:id" element={<EventDetail/>}/><Route path="/profile" element={<Profile session={session} refreshSession={refreshSession}/>}/><Route path="/me/registrations" element={<Registrations/>}/><Route path="/venues" element={<Venues/>}/><Route path="/venues/:id/calendar" element={<Calendar canBook={session.memberships.some(isOrganizer)}/>}/><Route path="/bookings/new" element={<CreateEvent session={session}/>}/><Route path="/organizer" element={<Organizer session={session}/>}/><Route path="/organizer/events/:id" element={<ManageEvent/>}/><Route path="/admin/bookings" element={usesMainBackend ? <WorkflowUnavailable title="Booking review"/> : <Admin session={session}/>}/><Route path="/notifications" element={<Notifications refreshInbox={refreshInbox}/>}/><Route path="/organizer/clubs/:id/reports" element={usesMainBackend ? <WorkflowUnavailable title="Club reports"/> : <Reports/>}/><Route path="*" element={<main><h1>Page not found</h1></main>}/></Routes></> }
function WorkflowUnavailable({ title }) {
  return <main><PageHeading title={title} description="This workflow requires the ClubSpace v1 provider."/><Link to="/events">Back to events</Link></main>
}
function Events() {
  const [q, setQ] = useState('')
  const [phase, setPhase] = useState('upcoming')
  const [club, setClub] = useState('')
  const [venue, setVenue] = useState('')
  const [visibility, setVisibility] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [page, setPage] = useState(1)
  const clubs = useAllOptions('/clubs')
  const venues = useAllOptions('/venues')
  const from = fromDate && toDate ? campusInstant(fromDate, '00:00') : ''
  const to = fromDate && toDate ? campusInstant(addDays(toDate, 1), '00:00') : ''
  const invalidRange = Boolean(fromDate || toDate) && (!from || !to || new Date(to) <= new Date(from) || new Date(to) - new Date(from) > 93 * 86400000)
  const r = useResource(invalidRange ? null : `/events${query({q, phase, club_id:club, venue_id:venue, visibility, from, to, page})}`)
  const change = setter => event => { setter(event.target.value); setPage(1) }
  return <main><PageHeading title="Find your next event." description="Explore what’s happening across campus."/>
    <div className="filters">
      <label>Search<input value={q} maxLength={100} onChange={change(setQ)}/></label>
      <label>When<select value={phase} onChange={change(setPhase)}><option value="upcoming">Upcoming</option><option value="past">Past</option></select></label>
      <label>Club<select value={club} onChange={change(setClub)}><option value="">All clubs</option>{clubs.data?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Venue<select value={venue} onChange={change(setVenue)}><option value="">All venues</option>{venues.data?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Visibility<select value={visibility} onChange={change(setVisibility)}><option value="">All</option><option value="public">Public</option><option value="members_only">Members only</option></select></label>
      <label>From date<input type="date" value={fromDate} onChange={change(setFromDate)}/></label>
      <label>Through date<input type="date" value={toDate} onChange={change(setToDate)}/></label>
    </div>
    <ErrorNotice error={clubs.error}/><ErrorNotice error={venues.error}/>
    {invalidRange ? <p role="alert">Choose both dates in order, spanning no more than 93 days.</p> : <Resource value={r} empty="No events match these filters."><div className="grid">{r.data?.map(event => <EventCard key={event.id} event={event}/>)}</div><Pagination meta={r.meta} page={page} setPage={setPage}/></Resource>}
  </main>
}
function EventCard({ event }) {
  return <article className="panel event-card">
    <p className="event-date">{campusTime(event.start_at)} HKT</p>
    <h2><Link to={`/events/${event.id}`}>{event.title}</Link></h2>
    <p>{event.club?.name} · {event.venue?.name}</p>
    <p>{event.visibility === 'members_only' ? 'Members only' : 'Open to everyone'} · {event.joined_count} of {event.capacity} places filled{event.waitlisted_count > 0 && ` · ${event.waitlisted_count} waiting`}</p>
  </article>
}
function EventDetail() {
  const { id } = useParams()
  const event = useResource(`/events/${id}`)
  const action = useAction(event.refresh)
  const refreshEvent = event.refresh
  useEffect(() => { window.addEventListener('focus', refreshEvent); return () => window.removeEventListener('focus', refreshEvent) }, [refreshEvent])
  const details = event.data
  const registration = details?.my_registration
  const active = ['joined', 'waitlisted'].includes(registration?.status)
  const reasons = { MEMBERSHIP_REQUIRED: 'Join this club to register.', REGISTRATION_CLOSED: 'Registration has closed.', EVENT_CANCELLED: 'This event has been cancelled.', EVENT_FULL: 'The event is full.', WAITLIST_FULL: 'The waitlist is full.', NOT_PUBLISHED: 'This event is not published.' }
  return <main><Resource value={event}>{details && <>
    <p><Link to="/events">← All events</Link></p>
    <h1>{details.title}</h1><p>{details.club?.name} · {details.visibility === 'members_only' ? 'Members only' : 'Open to everyone'}</p>
    <div className="detail-layout"><section className="panel detail-content"><h2>About this event</h2><p>{details.description}</p><h2>When and where</h2><dl className="facts"><div><dt>Starts</dt><dd>{campusTime(details.start_at)} HKT</dd></div><div><dt>Ends</dt><dd>{campusTime(details.end_at)} HKT</dd></div><div><dt>Venue</dt><dd>{details.venue?.name}</dd></div></dl></section>
      <aside className="panel registration-panel"><h2>Registration</h2><p><strong>{details.joined_count} of {details.capacity} places filled</strong><br/>{details.waitlisted_count} on the waitlist</p>{details.registration_closes_at && <p>Closes {campusTime(details.registration_closes_at)} HKT</p>}<p>{registration?.status === 'none' ? 'You have not registered.' : `Your registration: ${registration?.status?.replaceAll('_', ' ')}`}{registration?.queue_position != null && ` · Approximate position ${registration.queue_position}`}</p>
      {details.eligibility?.reason && reasons[details.eligibility.reason] && <p>{reasons[details.eligibility.reason]} {details.eligibility.reason === 'MEMBERSHIP_REQUIRED' && <Link to="/profile">View clubs</Link>}</p>}<Feedback action={action}/>
      {active ? <button disabled={action.busy} onClick={() => action.run(`/events/${id}/registration`, 'DELETE', {}, 'Registration updated.')}>Leave {registration.status === 'waitlisted' ? 'waitlist' : 'event'}</button> : <button disabled={action.busy || !(details.eligibility?.can_register || details.eligibility?.can_waitlist)} onClick={() => action.run(`/events/${id}/registration`, 'POST', { allow_waitlist: !!details.eligibility.can_waitlist }, 'Registration updated.')}>{details.eligibility?.can_waitlist ? 'Join waitlist' : 'Join event'}</button>}</aside></div>
  </>}</Resource></main>
}
function Profile({session,refreshSession}) { const profile=useResource('/profile'); const clubs=useAllOptions('/clubs'); const memberships=useAllOptions('/me/memberships'); const [form,setForm]=useState(null); useEffect(()=>{ if(profile.data) setForm(f=>f || {name:profile.data.name,email:profile.data.email}) },[profile.data]); const refresh=()=>{ profile.refresh();clubs.refresh();memberships.refresh();refreshSession() }; const action=useAction(refresh); return <main><h1>Profile</h1><Resource value={profile}>{form && profile.data && <form className="panel stack" onSubmit={e=>{e.preventDefault(); action.run('/profile','PATCH',form)}}><label>Name<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Email<input required type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label><p>Student ID: {profile.data.student_id} · Role: {session.user.platform_role === 'venue_admin' ? 'Venue administrator' : 'Student'}</p><button disabled={action.busy}>Save profile</button></form>}</Resource><Feedback action={action}/><h2>Club memberships</h2><Resource value={memberships} allowEmpty><Resource value={clubs}>{clubs.data?.map(c=>{ const m=memberships.data?.find(x=>x.club_id===c.id); return <article className="panel" key={c.id}><h3>{c.name}</h3><p>{c.description}</p><p>{m ? `Member: ${m.role}` : c.request_status === 'pending' ? 'Join request pending' : 'Not a member'}</p><button disabled={action.busy || (m && isOrganizer(m)) || c.request_status === 'pending'} onClick={()=>action.run(`/clubs/${c.id}/membership`,m?'DELETE':'PUT',{},m ? 'Membership removed.' : usesMainBackend ? 'Join request sent.' : 'Membership joined.')}>{m ? 'Leave club' : usesMainBackend ? 'Request to join' : 'Join club'}</button>{m && isOrganizer(m) && <p>Organizer membership cannot be removed here.</p>}</article> })}</Resource></Resource></main> }
function Registrations() { const [status,setStatus]=useState(''); const [page,setPage]=useState(1); const r=useResource(`/me/registrations${query({status,page})}`); return <main><h1>My registrations</h1><label>Status<select value={status} onChange={e=>{setStatus(e.target.value);setPage(1)}}><option value="">All</option>{['joined','waitlisted','left','cancelled'].map(x=><option key={x}>{x}</option>)}</select></label><Resource value={r} empty={<span>No registrations yet. <Link to="/events">Explore events</Link></span>}>{r.data?.map((x,i)=><article className="panel" key={x.event.id || i}><Link to={`/events/${x.event.id}`}>{x.event.title}</Link><p>{campusTime(x.event.start_at)} HKT · {x.status}{x.queue_position && ` · approximate queue position ${x.queue_position}`}</p></article>)}<Pagination meta={r.meta} page={page} setPage={setPage}/></Resource></main> }
function Venues() { const r=useAllOptions('/venues'); return <main><PageHeading title="Venues" description="Find a space for your next gathering."/><Resource value={r} empty="No venues available."><div className="grid">{r.data?.map(v=><article className="panel" key={v.id}><h2>{v.name}</h2><p>{v.location} · Capacity {v.capacity}</p><p>{v.description}</p><p>{v.is_active?'Active':'Unavailable'}</p><Link to={`/venues/${v.id}/calendar`}>View calendar</Link></article>)}</div></Resource></main> }
const calendarWeekday = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'Asia/Hong_Kong' })
const calendarDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Hong_Kong' })
const calendarRange = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Hong_Kong' })

function CalendarSlot({ date, label, slot, bookings, venueId, canBook }) {
  const availability = slotAvailability(campusInstant(date, slot.start), campusInstant(date, slot.end), bookings)
  if (availability.status === 'past') return <span className="calendar-slot is-past">Past</span>
  if (availability.status === 'busy') {
    const titles = availability.bookings.map(booking => booking.title).filter(Boolean)
    return <div className="calendar-slot is-reserved">
      <strong>Reserved</strong>
      {titles.length > 0 && <small>{titles.join(', ')}</small>}
    </div>
  }
  if (!canBook) return <span className="calendar-slot is-available">Available</span>
  return <Link
    className="calendar-slot is-available"
    to={`/bookings/new${query({ venue_id: venueId, date, slot_id: slot.id })}`}
    aria-label={`Available, select ${label}, ${slot.start} to ${slot.end}`}
  >Available</Link>
}

function Calendar({ canBook }) {
  const { id } = useParams()
  const [today, setToday] = useState(() => campusDate(new Date()))
  const [day, setDay] = useState(today)
  const week = weekStart(day)
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(week, index)
    const instant = new Date(campusInstant(date))
    return { date, weekday: calendarWeekday.format(instant), shortDate: calendarDate.format(instant), instant }
  })
  const config = useResource('/config')
  const venues = useAllOptions('/venues')
  const calendar = useResource(`/venues/${id}/calendar${query({ from: campusInstant(week), to: campusInstant(addDays(week, 7)) })}`)
  const showBookingLinks = !usesMainBackend || canBook
  const venueName = venues.data?.find(venue => String(venue.id) === id)?.name || 'Venue'
  const dayClass = date => `calendar-day${date === day ? ' is-selected' : ''}${date === today ? ' is-today' : ''}`
  function navigateWeek(offset) {
    const currentDate = campusDate(new Date())
    setToday(currentDate)
    setDay(selected => offset === 0 ? currentDate : addDays(selected, offset))
  }

  return <main>
    <p><Link to="/venues">← All venues</Link></p>
    <PageHeading title={`${venueName} calendar`} description={`Hong Kong time${!usesMainBackend ? ' · Pending requests do not reserve slots.' : ''}`}/>
    <section className="calendar-layout" aria-label="Venue availability">
      <div className="calendar-toolbar">
        <h2 aria-live="polite">{calendarRange.formatRange(days[0].instant, days[6].instant)}</h2>
        <div className="calendar-week-controls" role="group" aria-label="Week navigation">
          <button className="secondary-button" onClick={() => navigateWeek(-7)}>Previous week</button>
          <button className="secondary-button" onClick={() => navigateWeek(0)}>Today</button>
          <button className="secondary-button" onClick={() => navigateWeek(7)}>Next week</button>
        </div>
      </div>
      <label className="calendar-day-selector">Choose a day
        <select value={day} onChange={event => setDay(event.target.value)}>
          {days.map(({ date, weekday, shortDate }) => <option key={date} value={date}>
            {weekday}, {shortDate}{date === today ? ' (Today)' : ''}
          </option>)}
        </select>
      </label>
      {showBookingLinks && <p className="calendar-hint">Select an available time to start a booking.</p>}
      <Resource value={config}><Resource value={calendar}>
        <table className="venue-calendar" aria-label={`${venueName} time slots`}>
          <thead><tr>
            <th className="calendar-time" scope="col">Time</th>
            {days.map(({ date, weekday, shortDate }) => <th className={dayClass(date)} key={date} scope="col">
              <time dateTime={date} aria-current={date === today ? 'date' : undefined}>
                <span className="calendar-weekday">{weekday}{date === today && <span className="calendar-today">Today</span>}</span>
                <span className="calendar-date">{shortDate}</span>
              </time>
            </th>)}
          </tr></thead>
          <tbody>{calendar.data && config.data?.slots.map(slot => <tr key={slot.id}>
            <th className="calendar-time" scope="row">{slot.start}–{slot.end}</th>
            {days.map(({ date, weekday, shortDate }) => <td className={dayClass(date)} key={date}>
              <CalendarSlot date={date} label={`${weekday} ${shortDate}`} slot={slot} bookings={calendar.data.bookings} venueId={id} canBook={showBookingLinks}/>
            </td>)}
          </tr>)}</tbody>
        </table>
      </Resource></Resource>
    </section>
  </main>
}
function CreateEvent({ session }) {
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
function Organizer({session}) { const [club,setClub]=useState(''); const [state,setState]=useState(''); const [page,setPage]=useState(1); const r=useResource(`/me/events${query({club_id:club,state,page})}`); return <main><PageHeading title="Organizer" description="Manage your club events and requests."/><p><Link className="primary-link" to="/bookings/new">{usesMainBackend ? 'Book a venue and publish an event' : 'Request a venue and create a draft'}</Link></p><div className="filters"><label>Club<select value={club} onChange={e=>{setClub(e.target.value);setPage(1)}}><option value="">All committee clubs</option>{session.memberships.filter(isOrganizer).map(m=><option key={m.club_id} value={m.club_id}>{m.club_name}</option>)}</select></label><label>Event state<select value={state} onChange={e=>{setState(e.target.value);setPage(1)}}><option value="">All</option>{(usesMainBackend ? ['published','cancelled'] : ['draft','published','cancelled']).map(x=><option key={x}>{x}</option>)}</select></label></div>{!usesMainBackend && <p>Reports: {session.memberships.filter(isOrganizer).map(m=><span key={m.club_id}><Link to={`/organizer/clubs/${m.club_id}/reports`}>{m.club_name}</Link> </span>)}</p>}<Resource value={r} empty="No managed events.">{r.data?.map(e=><article className="panel" key={e.id}><h2><Link to={`/organizer/events/${e.id}`}>{e.title}</Link></h2><p>{e.club?.name} · {campusTime(e.start_at)} HKT</p><div className="status-row"><span>Event: {e.state}</span><span>Booking: {e.booking?.status || 'Unavailable'}</span></div></article>)}<Pagination meta={r.meta} page={page} setPage={setPage}/></Resource></main> }
function ManageEvent() { const { id } = useParams(); return <ManageEventEditor key={id} id={id}/> }
function ManageEventEditor({ id }) { const location=useLocation(); const r=useResource(`/events/${id}`); const [form,setForm]=useState(null); const [reason,setReason]=useState(''); const [status,setStatus]=useState('joined'); const [page,setPage]=useState(1); const participants=useResource(!usesMainBackend || r.data?.can_cancel ? `/events/${id}/participants${query({status,page})}` : null); useEffect(()=>{if(r.data) setForm(f=>f || {title:r.data.title,description:r.data.description,capacity:String(r.data.capacity),visibility:r.data.visibility,registration_closes_at:r.data.registration_closes_at ? new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(r.data.registration_closes_at)).replace(' ','T') : ''})},[r.data]); const action=useAction(r.refresh); const e=r.data; async function save(ev){ev.preventDefault(); const body = usesMainBackend
    ? { title: form.title, description: form.description }
    : { expected_version: e.version, title: form.title, description: form.description }; if(e.state==='draft') Object.assign(body,{capacity:Number(form.capacity),visibility:form.visibility,registration_closes_at:campusInstant(form.registration_closes_at.slice(0,10),form.registration_closes_at.slice(11,16))}); await action.run(`/events/${id}`,'PATCH',body) } return <main><Resource value={r}>{e && form && <><h1>{e.title}</h1>{location.state?.created && <p role="status">{usesMainBackend ? 'Venue booked and event published.' : 'Request submitted; venue approval pending.'}</p>}<div className="status-row"><span>Event: {e.state}</span><span>Booking: {e.booking?.status}</span></div>{e.booking?.decision_reason && <p>Decision reason: {e.booking.decision_reason}</p>}<p>{campusTime(e.start_at)} HKT · {e.venue?.name}</p><p>To reschedule, start a new request. Creating a new event does not cancel this event.</p>{(!usesMainBackend || e.can_cancel) && <Link to="/bookings/new" state={{copyEvent:{club_id:e.club?.id,venue_id:e.venue?.id,title:e.title,description:e.description,visibility:e.visibility,capacity:e.capacity}}}>Copy details to a new request</Link>}<Feedback action={action}/>{e.state!=='cancelled' && (!usesMainBackend || e.can_cancel) && <>{(!usesMainBackend || e.phase !== 'past') && <form className="panel stack" onSubmit={save}><h2>Edit event</h2><label>Title<input required value={form.title} onChange={x=>setForm({...form,title:x.target.value})}/></label><label>Description<textarea required value={form.description} onChange={x=>setForm({...form,description:x.target.value})}/></label>{e.state==='draft' && <><label>Capacity<input type="number" required min="1" max="500" value={form.capacity} onChange={x=>setForm({...form,capacity:x.target.value})}/></label><label>Visibility<select value={form.visibility} onChange={x=>setForm({...form,visibility:x.target.value})}><option value="public">Public</option><option value="members_only">Members only</option></select></label><label>Registration deadline (Hong Kong time)<input type="datetime-local" required value={form.registration_closes_at} onChange={x=>setForm({...form,registration_closes_at:x.target.value})}/></label></>}<button disabled={action.busy}>Save changes</button></form>}{e.state==='draft' && e.booking?.status==='confirmed' && <button disabled={action.busy} onClick={()=>action.run(`/events/${id}/publish`,'POST',{expected_version:e.version},'Event published.')}>Publish event</button>}<form className="panel stack" onSubmit={ev=>{ev.preventDefault(); if(window.confirm('Cancel this event and its active registrations?')) action.run(`/events/${id}/cancel`,'POST',{expected_version:e.version,reason},'Event cancelled.')}}><h2>Cancel event</h2><p>Cancellation affects the booking and active participants.</p>{!usesMainBackend && <label>Reason<textarea required maxLength={500} value={reason} onChange={ev=>setReason(ev.target.value)}/></label>}<button disabled={action.busy}>Cancel event</button></form></>}{(!usesMainBackend || e.can_cancel) && <><h2>Participants</h2><label>Filter<select value={status} onChange={ev=>{setStatus(ev.target.value);setPage(1)}}>{(usesMainBackend ? ['joined','waitlisted'] : ['joined','waitlisted','left','cancelled']).map(x=><option key={x}>{x}</option>)}</select></label><Resource value={participants} empty="No participants in this state."><div className="table-wrap"><table><thead><tr><th>Name</th>{!usesMainBackend && <><th>Email</th><th>Student ID</th></>}<th>Status</th>{!usesMainBackend && <th>Queue position</th>}</tr></thead><tbody>{participants.data?.map(p=><tr key={p.user.id}><td>{p.user.name}</td>{!usesMainBackend && <><td>{p.user.email}</td><td>{p.user.student_id}</td></>}<td>{p.status}</td>{!usesMainBackend && <td>{p.queue_position ?? '—'}</td>}</tr>)}</tbody></table></div><Pagination meta={participants.meta} page={page} setPage={setPage}/></Resource></>}</>}</Resource></main> }
function Admin({session}) { const clubs=useAllOptions('/clubs'); const venues=useAllOptions('/venues'); const [page,setPage]=useState(1); const r=useResource(`/bookings${query({status:'pending',page})}`); const [reasons,setReasons]=useState({}); const action=useAction(r.refresh); const own=new Set(session.memberships.filter(isOrganizer).map(m=>m.club_id)); return <main><PageHeading title="Booking review" description="Approval does not publish the event. Availability is checked again."/><Feedback action={action}/><h2>Pending requests {r.meta && `(${r.meta.total})`}</h2><Resource value={r} empty="You’re all caught up. There are no pending requests.">{r.data?.map(b=><article className="panel stack" key={b.id}><h2>{b.event_title}</h2><p>{clubs.data?.find(club => club.id === b.club_id)?.name || `Club ${b.club_id}`} · {venues.data?.find(venue => venue.id === b.venue_id)?.name || `Venue ${b.venue_id}`} · {campusTime(b.start_at)}–{campusTime(b.end_at)} HKT</p><p>{b.expired?'Expired':'Pending'}</p>{own.has(b.club_id) && <p>You cannot decide a request for your own committee club.</p>}<label>Decision reason (required for rejection)<textarea maxLength={500} value={reasons[b.id]||''} onChange={e=>setReasons({...reasons,[b.id]:e.target.value})}/></label><div className="row"><button disabled={action.busy || b.expired || own.has(b.club_id)} onClick={()=>action.run(`/bookings/${b.id}/decision`,'POST',{expected_version:b.version,decision:'approve',...(reasons[b.id]?.trim()?{reason:reasons[b.id].trim()}: {})},'Booking approved; event remains a draft.')}>Approve</button><button disabled={action.busy || b.expired || own.has(b.club_id) || !reasons[b.id]?.trim()} onClick={()=>action.run(`/bookings/${b.id}/decision`,'POST',{expected_version:b.version,decision:'reject',reason:reasons[b.id].trim()},'Booking rejected.')}>Reject</button></div></article>)}<Pagination meta={r.meta} page={page} setPage={setPage}/></Resource></main> }
function Notifications({refreshInbox}) { const [page,setPage]=useState(1); const [unread,setUnread]=useState(false); const r=useResource(`/notifications${query({unread_only:unread?'true':'',page})}`); const refreshList=r.refresh; const refresh=()=>{refreshList();refreshInbox()}; const action=useAction(refresh); useEffect(()=>{const f=()=>{if(!document.hidden) refreshList()};const t=setInterval(f,30000);window.addEventListener('focus',f);document.addEventListener('visibilitychange',f);return()=>{clearInterval(t);window.removeEventListener('focus',f);document.removeEventListener('visibilitychange',f)}},[refreshList]); return <main><h1>Notifications</h1>{!usesMainBackend && <p>Delivery is asynchronous and may take a moment.</p>}<label><input type="checkbox" checked={unread} onChange={e=>{setUnread(e.target.checked);setPage(1)}}/> Unread only</label><Feedback action={action}/><Resource value={r} empty={unread ? "No unread notifications." : "Your inbox is empty."}><p>{r.meta?.unread_count} unread {usesMainBackend ? 'in recent notifications' : 'in total'}</p>{r.data?.map(n=><article className="panel" key={n.id}><h2>{n.title} {!n.read_at && '(Unread)'}</h2><p>{n.body}</p><p>{campusTime(n.created_at)} HKT</p>{n.event_id && <Link to={`/events/${n.event_id}`}>View event</Link>} {!n.read_at && <button disabled={action.busy} onClick={()=>action.run(`/notifications/${n.id}/read`,'PATCH',{},'Marked as read.')}>Mark as read</button>}</article>)}<Pagination meta={r.meta} page={page} setPage={setPage}/></Resource></main> }
function Reports() {
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
export default function App(){return <BrowserRouter><Shell/></BrowserRouter>}
