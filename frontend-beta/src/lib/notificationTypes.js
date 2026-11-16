import {
  Bell, CalendarX, CalendarCheck, CalendarClock, ChartColumn, ClipboardCheck, Clock, Megaphone, PenLine,
  QrCode, ShieldCheck, Ticket, UserCog, UserPlus, Users,
} from 'lucide-react'
import { campusDate, addDays } from '../apiShared.js'

// Every notification type the API can send (beta-feedback.md section 3), with
// an icon and a label so the Inbox reads as words first, colour second.
export const NOTIFICATION_TYPES = {
  event_published: { icon: Megaphone, label: 'New event' },
  event_changed: { icon: PenLine, label: 'Event changed' },
  event_cancelled: { icon: CalendarX, label: 'Event cancelled' },
  event_reminder: { icon: Clock, label: 'Reminder' },
  registration_changed: { icon: Ticket, label: 'Your registration' },
  booking_requested: { icon: ClipboardCheck, label: 'Venue request' },
  booking_decided: { icon: CalendarCheck, label: 'Venue decision' },
  signoff_requested: { icon: ShieldCheck, label: 'Needs the president' },
  signoff_decided: { icon: ShieldCheck, label: 'President’s decision' },
  role_changed: { icon: UserCog, label: 'Club role' },
  club_updated: { icon: Users, label: 'Club update' },
  checkin_opened: { icon: QrCode, label: 'Check-in open' },
  activity_digest: { icon: ChartColumn, label: 'Daily digest' },
  club_join_request: { icon: UserPlus, label: 'Join request' },
  event_join_request: { icon: UserPlus, label: 'Event request' },
  club_membership: { icon: Users, label: 'Club membership' },
  event: { icon: CalendarClock, label: 'Event' },
}

export const notificationMeta = type => NOTIFICATION_TYPES[type] ?? { icon: Bell, label: 'Notification' }

// "Today", "Yesterday" or "Fri 20 Nov", in campus time.
export function dayGroup(instant, now = new Date()) {
  const day = campusDate(new Date(instant))
  const today = campusDate(now)
  if (day === today) return 'Today'
  if (day === addDays(today, -1)) return 'Yesterday'
  return new Intl.DateTimeFormat('en-HK', { timeZone: 'Asia/Hong_Kong', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(instant)).replace(',', '')
}

// Groups an already-ordered list by day, keeping order.
export function groupByDay(items, now = new Date()) {
  const groups = []
  for (const item of items) {
    const label = dayGroup(item.created_at, now)
    const last = groups.at(-1)
    if (last?.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return groups
}
