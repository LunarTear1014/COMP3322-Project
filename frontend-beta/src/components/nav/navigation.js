import { Bell, Compass, Ticket, Users } from 'lucide-react'

// The same four destinations for every role. Organizer, Admin and Profile live
// under the account control, so student navigation never changes shape.
export const PRIMARY_TABS = [
  { to: '/events', label: 'Explore', icon: Compass, match: path => path === '/' || path.startsWith('/events') },
  { to: '/me/registrations', label: 'My events', icon: Ticket, match: path => path.startsWith('/me/') },
  { to: '/clubs', label: 'Clubs', icon: Users, match: path => path.startsWith('/clubs') },
  { to: '/notifications', label: 'Inbox', icon: Bell, match: path => path.startsWith('/notifications'), badge: true },
]

export function isActive(tab, pathname) {
  return tab.match(pathname)
}

// "3" for the badge; undefined at 0 so nothing renders. Capped for width.
export function badgeText(count) {
  if (!count || count < 1) return undefined
  return count > 99 ? '99+' : String(count)
}
