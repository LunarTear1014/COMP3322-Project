import { useCallback, useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { request, setCsrf, usesMainBackend } from './api'
import { Reports } from './pages/Reports'
import { isOrganizer } from './lib/roles'
import { ErrorNotice } from './components/common'
import { AppHeader } from './components/nav/AppHeader'
import { TabBar } from './components/nav/TabBar'
import { AuthForm } from './pages/AuthPage'
import { WorkflowUnavailable } from './pages/WorkflowUnavailable'
import { Clubs } from './pages/Clubs'
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
import { Notifications } from './pages/Notifications'
import { ToastProvider, useToast } from './components/ui'
import { useLiveInbox } from './hooks/useLiveInbox'
import { usePhone } from './hooks/useMediaQuery'
import './App.css'

const INBOX_POLL_MS = 30000

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

  useEffect(() => {
    refreshSession()
    const expired = () => { setSession(null); setCsrf(null) }
    window.addEventListener('clubspace:unauthorized', expired)
    return () => window.removeEventListener('clubspace:unauthorized', expired)
  }, [refreshSession])

  const refreshInbox = useCallback(async () => {
    if (!session || document.hidden) return
    try {
      const result = await request('/notifications?page=1&page_size=1')
      setUnread(result.meta?.unread_count ?? 0)
    } catch {
      // The inbox page shows its own errors.
    }
  }, [session])

  // The v1 provider streams notifications (SSE) with a 60 s polling fallback.
  // The legacy beta provider has no stream, so it keeps polling every 30 s.
  const toast = useToast()
  useLiveInbox({
    enabled: Boolean(session) && !usesMainBackend,
    refreshInbox,
    onUnread: setUnread,
    onNotification: notification => toast.show({ message: notification.title, tone: 'info', action: { label: 'View', onClick: () => navigate('/notifications') } }),
    streamFactory: streamOverride,
  })
  useEffect(() => {
    if (!session || !usesMainBackend) return undefined
    refreshInbox()
    const id = setInterval(refreshInbox, INBOX_POLL_MS)
    const onFocus = () => { if (!document.hidden) refreshInbox() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [session, refreshInbox])

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
  const publicPage = location.pathname === '/login' || location.pathname === '/register'
  if (!session && !publicPage) {
    return <Navigate to={`/login?return=${encodeURIComponent(location.pathname + location.search)}`} replace />
  }
  if (!session) return <AuthForm key={location.pathname} mode={location.pathname.slice(1)} onLogin={setSession} />

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
          <Route path="/login" element={<Navigate to="/events" replace />} />
          <Route path="/register" element={<Navigate to="/events" replace />} />
          <Route path="/events" element={<Events />} />
          <Route path="/events/:id" element={<EventDetail />} />
          <Route path="/profile" element={<Profile session={session} refreshSession={refreshSession} />} />
          <Route path="/me/registrations" element={<Registrations />} />
          <Route path="/venues" element={<Venues />} />
          <Route path="/venues/:id/calendar" element={<Calendar canBook={organizer} />} />
          <Route path="/clubs" element={<ClubsDirectory session={session} refreshSession={refreshSession} />} />
          <Route path="/organizer/clubs" element={organizer ? <Clubs refreshSession={refreshSession} /> : <Navigate to="/clubs" replace />} />
          <Route path="/bookings/new" element={<CreateEvent session={session} />} />
          <Route path="/organizer" element={<Organizer session={session} />} />
          <Route path="/organizer/events/:id" element={<ManageEvent />} />
          <Route path="/admin/bookings" element={usesMainBackend ? <WorkflowUnavailable title="Booking review" /> : <Admin session={session} />} />
          <Route path="/notifications" element={<Notifications refreshInbox={refreshInbox} />} />
          <Route path="/organizer/clubs/:id/reports" element={usesMainBackend ? <WorkflowUnavailable title="Club reports" /> : <Reports />} />
          <Route path="*" element={<main><h1>Page not found</h1></main>} />
        </Routes>
      </div>
      {phone && <TabBar unread={unread} />}
    </>
  )
}

export default function App({ streamFactory }) {
  return <BrowserRouter><ToastProvider><Shell streamOverride={streamFactory} /></ToastProvider></BrowserRouter>
}
