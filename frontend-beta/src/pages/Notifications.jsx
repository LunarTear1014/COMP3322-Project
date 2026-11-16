import { CheckCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { request, query } from '../api'
import { PageHeading, Resource, Pagination, Feedback } from '../components/common'
import { Button, EmptyState, useToast } from '../components/ui'
import { useResource, useAction } from '../hooks/resources'
import { timeLine } from '../lib/format'
import { groupByDay, notificationMeta } from '../lib/notificationTypes'

const REFRESH_MS = 60000

function NotificationRow({ item, action }) {
  const { icon: Icon, label } = notificationMeta(item.type)
  const review = decision => action.run(
    `/clubs/${item.club_id}/join-requests/${item.join_request_id}/review`, 'POST', { decision },
    decision === 'accept' ? 'Join request approved.' : 'Join request rejected.',
  )
  return (
    <li className={`notification${item.read_at ? '' : ' is-unread'}`}>
      <span className="notification-icon" aria-hidden="true"><Icon className="cs-icon" /></span>
      <div className="notification-body">
        <h3>{item.title}{!item.read_at && <span className="cs-sr"> (unread)</span>}</h3>
        <p>{item.body}</p>
        <div className="notification-meta">
          <span>{label}</span>
          <time dateTime={item.created_at}>{timeLine(item.created_at)}</time>
          {item.event_id && <Link to={`/events/${item.event_id}`} state={{ source: 'inbox' }}>View event</Link>}
        </div>
        {item.type === 'club_join_request' && (
          <div className="cs-row">
            <Button disabled={action.busy} onClick={() => review('accept')}>Approve request</Button>
            <Button disabled={action.busy} onClick={() => review('reject')}>Reject request</Button>
          </div>
        )}
        {!item.read_at && <div><Button variant="ghost" disabled={action.busy} onClick={() => action.run(`/notifications/${item.id}/read`, 'PATCH', {}, 'Marked as read.')}>Mark as read</Button></div>}
      </div>
    </li>
  )
}

// Inbox: typed notifications grouped by day. Delivery is eventual; a message
// can describe an action that has since changed, so links refetch the target.
export function Notifications({ refreshInbox }) {
  const [page, setPage] = useState(1)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [marking, setMarking] = useState(false)
  const toast = useToast()
  const list = useResource(`/notifications${query({ unread_only: unreadOnly ? 'true' : '', page })}`)
  const refreshList = list.refresh
  const refresh = () => { refreshList(); refreshInbox() }
  const action = useAction(refresh)

  useEffect(() => {
    const onFocus = () => { if (!document.hidden) refreshList() }
    const timer = setInterval(onFocus, REFRESH_MS)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [refreshList])

  const unread = (list.data || []).filter(item => !item.read_at)

  // The API marks one notification at a time, so "Mark all as read" marks the
  // unread ones on this page and reports any that failed.
  async function markAll() {
    setMarking(true)
    const results = await Promise.allSettled(unread.map(item => request(`/notifications/${item.id}/read`, { method: 'PATCH', body: {} })))
    setMarking(false)
    const failed = results.filter(result => result.status === 'rejected').length
    refresh()
    toast.show(failed
      ? { message: `${failed} could not be marked as read. Try again.`, tone: 'error' }
      : { message: 'All caught up.' })
  }

  const groups = groupByDay(list.data || [])
  return (
    <main className="page">
      <PageHeading title="Inbox" description="Messages can arrive a moment after the action that caused them." />
      <div className="cs-row inbox-tools">
        <button className="cs-chip-filter" type="button" aria-pressed={unreadOnly} onClick={() => { setUnreadOnly(value => !value); setPage(1) }}>Unread only</button>
        <Button disabled={!unread.length || marking} busy={marking} onClick={markAll}><CheckCheck className="cs-icon" aria-hidden="true" />Mark all as read</Button>
        {list.meta && <span className="cs-meta cs-nums" role="status">{list.meta.unread_count} unread in total</span>}
      </div>
      <Feedback action={action} />
      <Resource
        value={list}
        empty={<EmptyState title={unreadOnly ? 'No unread messages' : 'You’re all caught up'}>{unreadOnly ? 'Everything here has been read.' : 'New events, decisions and reminders will show up here.'}</EmptyState>}
      >
        {groups.map(group => (
          <section key={group.label} aria-label={group.label}>
            <h2 className="day-heading">{group.label}</h2>
            <ul className="stack-list">{group.items.map(item => <NotificationRow key={item.id} item={item} action={action} />)}</ul>
          </section>
        ))}
        <Pagination meta={list.meta} page={page} setPage={setPage} />
      </Resource>
    </main>
  )
}
