import { useState } from 'react'
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
  const [student_clubs, set_student_clubs] = useState([
    'Photography Society',
  ])

  function toggle_club_membership(club) {
    set_student_clubs((current_clubs) => {
      if (current_clubs.includes(club)) {
        return current_clubs.filter(
          (current_club) => current_club !== club
        )
      }

      return [...current_clubs, club]
    })
  }
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/events" replace />} />

        <Route
          path="/events"
          element={<EventsPage student_clubs={student_clubs} />}
        />

        <Route
          path="/profile"
          element={
            <ProfilePage
              student_clubs={student_clubs}
              onToggleClub={toggle_club_membership}
            />
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
