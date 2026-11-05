import { useCallback, useEffect, useState } from 'react'
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
} from 'react-router'
import EventsPage from './pages/EventsPage'
import ProfilePage from './pages/ProfilePage'
import VenuePage from './pages/VenuePage'
import BookingPage from './pages/BookingPage'
import ClubsPage from './pages/ClubsPage'
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
            />
          }
        />

        <Route path="/profile" element={<ProfilePage />} />
        <Route
          path="/clubs"
          element={
            <ClubsPage onMembershipsChange={update_memberships} />
          }
        />
        <Route
          path="/venues"
          element={<VenuePage />}
        />
        <Route path="/bookings/new" element={<BookingPage />} />
        <Route
          path="/organizer"
          element={<PlaceholderPage title="Organizer dashboard" />}
        />
      </Routes>
    </BrowserRouter>
  )
}

export default App
