import { useCallback, useEffect, useState } from 'react'
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
} from 'react-router'
import EventsPage from './pages/EventsPage'
import VenuePage from './pages/VenuePage'
import BookingPage from './pages/BookingPage'
import ClubsPage from './pages/ClubsPage'
import AccountPage from './pages/AccountPage'
import './App.css'

function PlaceholderPage({ title }) {
  return (
    <main>
      <section className="panel">
        <p>Coming next</p>
        <h1>{title}</h1>
        <p>This page will be built in a later step.</p>

        <NavLink to="/events">
          Back to events
        </NavLink>
      </section>
    </main>
  )
}

function App() {
  const [membership_state, set_membership_state] = useState({
    memberships: [],
    error: false,
  })

  const refresh_memberships = useCallback(async () => {
    try {
      const response = await fetch('/api/memberships')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      set_membership_state({ memberships: data, error: false })
    } catch {
      set_membership_state({ memberships: [], error: true })
    }
  }, [])

  const update_memberships = useCallback((memberships) => {
    set_membership_state({ memberships, error: false })
  }, [])

  useEffect(() => {
    let active = true

    async function load_memberships() {
      try {
        const response = await fetch('/api/memberships')
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json()
        if (active) set_membership_state({ memberships: data, error: false })
      } catch {
        if (active) set_membership_state({ memberships: [], error: true })
      }
    }

    load_memberships()
    return () => {
      active = false
    }
  }, [])

  const student_clubs = membership_state.memberships.map(
    (membership) => membership.name
  )
  const can_manage_venues = membership_state.memberships.some((membership) =>
    ['committee', 'president'].includes(membership.role),
  )

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/events" replace />} />

        <Route
          path="/events"
          element={
            <EventsPage
              student_clubs={student_clubs}
              membership_error={membership_state.error}
              can_manage_venues={can_manage_venues}
            />
          }
        />

        <Route
          path="/account"
          element={
            <AccountPage
              onMembershipsRefresh={refresh_memberships}
              can_manage_venues={can_manage_venues}
            />
          }
        />
        <Route
          path="/clubs"
          element={
            <ClubsPage
              onMembershipsChange={update_memberships}
              can_manage_venues={can_manage_venues}
            />
          }
        />
        <Route
          path="/venues"
          element={<VenuePage can_manage_venues={can_manage_venues} />}
        />
        <Route
          path="/bookings/new"
          element={<BookingPage can_manage_venues={can_manage_venues} />}
        />
        <Route
          path="/organizer"
          element={<PlaceholderPage title="Organizer dashboard" />}
        />
      </Routes>
    </BrowserRouter>
  )
}

export default App
