import { useCallback, useEffect, useState } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, matchPath, useLocation, useNavigate } from 'react-router'
import { request, setCsrf } from './api'
import { Reports } from './pages/Reports'
import { isOrganizer } from './lib/roles'
import { ErrorNotice } from './components/common'
import { AppHeader } from './components/nav/AppHeader'
import { TabBar } from './components/nav/TabBar'
import { AuthForm } from './pages/AuthPage'
import { ProfileCompletion } from './pages/ProfileCompletion'
import { Credits } from './pages/Credits'
import { PrivacyPolicy, Terms } from './pages/Legal'
import { ClubMembers, ClubTools } from './pages/ClubTools'
import { Effectiveness } from './pages/Effectiveness'
import { ClubsDirectory } from './pages/ClubsDirectory'
import { Events } from './pages/Events'
import { EventDetail } from './pages/EventDetail'
import { Profile } from './pages/Profile'
import { Registrations } from './pages/Registrations'
import { Venues } from './pages/Venues'
import { Calendar } from './pages/Calendar'
import { CreateEvent } from './pages/CreateEvent'
import { Organizer } from './pages/Organizer'
import { ManageEvent } from './pages/ManageEvent'
import { Admin } from './pages/Admin'
import { AdminSchedule } from './pages/AdminSchedule'
import { Notifications } from './pages/Notifications'
import { ToastProvider, useToast } from './components/ui'
import { useLiveInbox } from './hooks/useLiveInbox'
import { dispatchNotification } from './hooks/useLiveSignal'
import { usePhone } from './hooks/useMediaQuery'
import './App.css'
import { safeReturn } from './lib/navigation'

// Session identity and memberships, for spotting a real change.
// Every signed-in page, so a signed-out visit to anything else is a plain
// "Page not found" rather than a sign-in prompt (NAV-02).
const APP_PATHS = [
  '/', '/events', '/events/:id', '/profile', '/me/registrations', '/venues', '/venues/:id/calendar', '/clubs',
  '/organizer', '/organizer/clubs', '/organizer/club-tools', '/organizer/clubs/:id/members', '/organizer/clubs/:id/reports',
  '/organizer/clubs/:id/reports/effectiveness', '/organizer/events/:id', '/bookings/new', '/admin/bookings', '/admin/schedule', '/notifications',
]
const knownPath = pathname => APP_PATHS.some(pattern => matchPath(pattern, pathname))

function NotFound({ signedIn }) {
  return (
    <main className="page" id={signedIn ? undefined : 'main-content'}>
      <h1>Page not found</h1>
      <p>That address doesn’t match a ClubSpace page.</p>
      <p>{signedIn ? <Link className="cs-btn" to="/events">Go to Explore</Link> : <Link className="cs-btn" to="/login">Sign in</Link>}</p>
    </main>
  )
}

const ROLE_TYPES = new Set(['role_changed', 'club_membership'])
const sessionKey = data => JSON.stringify([data?.user, data?.memberships])


function Shell({ streamOverride }) {
  const [session, setSession] = useState(null)
  const [boot, setBoot] = useState(true)
  const [bootError, setBootError] = useState(null)
  const [unread, setUnread] = useState(0)
  const location = useLocation()
  const navigate = useNavigate()
  const phone = usePhone()

  const refreshSession = useCallback(async () => {
    try {
      const result = await request('/auth/session')
      setCsrf(result.data.csrf_token)
      setSession(result.data)
      setBootError(null)
    } catch (error) {
      if (error.status === 401) {
        setSession(null)
        setCsrf(null)
      } else {
        setBootError(error)
      }
    } finally {
      setBoot(false)
    }
  }, [])

  // Rechecks the session without disturbing the page: a signed-out session
  // goes to sign-in (keeping this page as the return path), and changed roles
  // replace the old ones. Other failures are left to the page's own request.
  const checkSession = useCallback(async () => {
    try {
      const result = await request('/auth/session')
      setCsrf(result.data.csrf_token)
      setSession(current => (current && sessionKey(current) === sessionKey(result.data) ? current : result.data))
    } catch (error) {
      if (error.status === 401) { setSession(null); setCsrf(null) }
    }
  }, [])

  useEffect(() => {
    refreshSession()
    const expired = () => { setSession(null); setCsrf(null) }
    // A refused CSRF token usually means the session ended in another tab (AUTH-06).
    const recheck = () => checkSession()
    const visible = () => { if (!document.hidden) checkSession() }
    window.addEventListener('clubspace:unauthorized', expired)
    window.addEventListener('clubspace:session-check', recheck)
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.removeEventListener('clubspace:unauthorized', expired)
      window.removeEventListener('clubspace:session-check', recheck)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [refreshSession, checkSession])

  const refreshInbox = useCallback(async () => {
    if (!session || document.hidden) return
    try {
      const result = await request('/notifications?page=1&page_size=1')
      setUnread(result.meta?.unread_count ?? 0)
    } catch {
      // The inbox page shows its own errors.
    }
  }, [session])

  // Notifications stream over SSE with a 60 s polling fallback.
  const toast = useToast()
  useLiveInbox({
    enabled: Boolean(session),
    refreshInbox,
    onUnread: setUnread,
    onNotification: notification => {
      dispatchNotification(notification)
      // Someone changed this user's club role: pick up the new permissions (F08).
      if (ROLE_TYPES.has(notification.type)) checkSession()
      // A hidden tab only updates its badge; a live notice never cuts an Undo window short.
      if (!document.hidden) toast.show({ message: notification.title, tone: 'info', passive: true, action: { label: 'View', onClick: () => navigate('/notifications') } })
    },
    streamFactory: streamOverride,
  })

  // Bars that float over the page: pages read this for scroll-padding and the
  // toast position, so focused fields are never hidden under them.
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--bars-height', session && phone ? '68px' : '0px')
    return () => root.style.removeProperty('--bars-height')
  }, [session, phone])

  async function logout() {
    try {
      await request('/auth/logout', { method: 'POST' })
    } catch (error) {
      if (error.status !== 401) { setBootError(error); return }
    }
    setCsrf(null)
    setSession(null)
    navigate('/login')
  }

  if (boot) return <main><p role="status">Loading session…</p></main>
  if (bootError && !session) {
    return <main><ErrorNotice error={bootError} /><button className="cs-btn" onClick={refreshSession}>Retry session</button></main>
  }
  // Credits, privacy and terms are public: they are linked from the sign-in
  // footer, and privacy and terms from Google's sign-in consent screen.
  if (!session && location.pathname === '/credits') return <Credits signedIn={false} />
  if (!session && location.pathname === '/privacy') return <PrivacyPolicy signedIn={false} />
  if (!session && location.pathname === '/terms') return <Terms signedIn={false} />
  const publicPage = location.pathname === '/login' || location.pathname === '/register'
  if (!session && !publicPage && !knownPath(location.pathname)) return <NotFound signedIn={false} />
  if (!session && !publicPage) {
    // A Google callback error marker (?error=…) must survive the signed-out
    // bounce: pass it through as its own query param so the auth page can
    // show the friendly message even though the marker is inside `return` too.
    const marker = new URLSearchParams(location.search).get('error')
    const bounce = new URLSearchParams({ return: location.pathname + location.search })
    if (marker) bounce.set('error', marker)
    return <Navigate to={`/login?${bounce}`} replace />
  }
  if (!session) return <AuthForm key={location.pathname} mode={location.pathname.slice(1)} onLogin={setSession} />

  // Profile Completion (ADR-0001): a Google-signed-in user without a student ID
  // completes the profile before anything else renders, on every route.
  // Only redirect when we have a confirmed session (not during bootstrap) and
  // student_id is explicitly null — avoids flicker during background refresh.
  if (session && session.user.student_id == null) return <ProfileCompletion session={session} refreshSession={refreshSession} />

  const organizer = session.memberships.some(isOrganizer)
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      {import.meta.env.MODE === 'fixtures' && <div className="preview-banner" role="status">Local preview · Sample data · Read-only</div>}
      <AppHeader session={session} unread={unread} showLinks={!phone} onSignOut={logout} />
      <ErrorNotice error={bootError} />
      <div id="main-content" tabIndex={-1} className="app-content">
        <Routes>
          <Route path="/" element={<Navigate to="/events" replace />} />
          {/* Signing in renders this before the sign-in form's own navigation
              lands, so it must honour ?return= as well (AUTH-03). */}
          <Route path="/login" element={<Navigate to={safeReturn(location.search)} replace />} />
          <Route path="/register" element={<Navigate to="/events" replace />} />
          <Route path="/events" element={<Events />} />
          <Route path="/events/:id" element={<EventDetail />} />
          <Route path="/profile" element={<Profile session={session} refreshSession={refreshSession} />} />
          <Route path="/me/registrations" element={<Registrations />} />
          <Route path="/venues" element={<Venues />} />
          <Route path="/venues/:id/calendar" element={<Calendar canBook={organizer} />} />
          <Route path="/clubs" element={<ClubsDirectory session={session} refreshSession={refreshSession} />} />
          <Route path="/organizer/clubs" element={organizer ? <ClubTools session={session} refreshSession={refreshSession} /> : <Navigate to="/clubs" replace />} />
          <Route path="/organizer/club-tools" element={<Navigate to="/organizer/clubs" replace />} />
          <Route path="/organizer/clubs/:id/members" element={organizer ? <ClubMembers session={session} refreshSession={refreshSession} /> : <Navigate to="/clubs" replace />} />
          <Route path="/organizer/clubs/:id/reports/effectiveness" element={organizer ? <Effectiveness /> : <Navigate to="/clubs" replace />} />
          <Route path="/bookings/new" element={<CreateEvent session={session} />} />
          <Route path="/organizer" element={<Organizer session={session} />} />
          <Route path="/organizer/events/:id" element={<ManageEvent session={session} />} />
          <Route path="/admin/bookings" element={<Admin session={session} />} />
          <Route path="/admin/schedule" element={<AdminSchedule session={session} />} />
          <Route path="/notifications" element={<Notifications refreshInbox={refreshInbox} />} />
          <Route path="/credits" element={<Credits signedIn />} />
          <Route path="/privacy" element={<PrivacyPolicy signedIn />} />
          <Route path="/terms" element={<Terms signedIn />} />
          <Route path="/organizer/clubs/:id/reports" element={<Reports />} />
          <Route path="*" element={<NotFound signedIn />} />
        </Routes>
      </div>
      {phone && <TabBar unread={unread} />}
    </>
  )
}

export default function App({ streamFactory }) {
  return <BrowserRouter><ToastProvider><Shell streamOverride={streamFactory} /></ToastProvider></BrowserRouter>
}
