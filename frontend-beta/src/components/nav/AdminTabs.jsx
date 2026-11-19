import { NavLink } from 'react-router'

// Venue administrator pages share this sub-navigation.
export function AdminTabs() {
  return (
    <nav className="admin-tabs" aria-label="Admin">
      <NavLink to="/admin/bookings" end>Booking review</NavLink>
      <NavLink to="/admin/schedule" end>Venue schedule</NavLink>
    </nav>
  )
}
