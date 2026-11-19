import { Bell, CalendarDays, Compass, LayoutDashboard, Ticket, Users } from 'lucide-react'
import { isOrganizer } from '../../lib/roles'

// Four destinations for every role. Organizer, Admin and Profile live under the
// account control, so navigation never changes shape. Venue administrators hold
// no registrations, so their second tab is the venue schedule.
export const PRIMARY_TABS = [
  { to: '/events', label: 'Explore', icon: Compass, match: path => path === '/' || path.startsWith('/events') },
  { to: '/me/registrations', label: 'My events', icon: Ticket, match: path => path.startsWith('/me/') },
  { to: '/clubs', label: 'Clubs', icon: Users, match: path => path.startsWith('/clubs') },
  { to: '/notifications', label: 'Inbox', icon: Bell, match: path => path.startsWith('/notifications'), badge: true },
]

const ADMIN_TAB = { to: '/admin/schedule', label: 'Schedule', icon: CalendarDays, match: path => path.startsWith('/admin/') }

export function primaryTabs(session) {
  return session?.user?.platform_role === 'venue_admin' ? PRIMARY_TABS.map(tab => (tab.to === '/me/registrations' ? ADMIN_TAB : tab)) : PRIMARY_TABS
}

// Organizers (committee or president of a club) get one more top-bar link, right
// after Clubs. It is not a tab: the phone bar stays at four, and on phones
// Organizer lives in the account menu instead. Venue admins hold no club role.
export const ORGANIZER_LINK = { to: '/organizer', label: 'Organizer', icon: LayoutDashboard, match: path => path.startsWith('/organizer') }

export function hasOrganizerLink(session) {
  return session?.user?.platform_role !== 'venue_admin' && Boolean(session?.memberships?.some(isOrganizer))
}

// The links in the desktop top bar: the primary tabs, plus Organizer after Clubs.
export function headerLinks(session) {
  const tabs = primaryTabs(session)
  if (!hasOrganizerLink(session)) return tabs
  const at = tabs.findIndex(tab => tab.to === '/clubs') + 1
  return [...tabs.slice(0, at), ORGANIZER_LINK, ...tabs.slice(at)]
}

export function isActive(tab, pathname) {
  return tab.match(pathname)
}

// "3" for the badge; undefined at 0 so nothing renders. Capped for width.
export function badgeText(count) {
  if (!count || count < 1) return undefined
  return count > 99 ? '99+' : String(count)
}
