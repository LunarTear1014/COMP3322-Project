import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { query, campusTime, usesMainBackend } from '../api'
import { Resource, Pagination, Feedback } from '../components/common'
import { useResource, useAction } from '../hooks/resources'

export function Notifications({refreshInbox}) {
  const [page,setPage]=useState(1)
  const [unread,setUnread]=useState(false)
  const r=useResource(`/notifications${query({unread_only:unread?'true':'',page})}`)
  const refreshList=r.refresh
  const refresh=()=>{refreshList();refreshInbox()}
  const action=useAction(refresh)
  useEffect(()=>{const f=()=>{if(!document.hidden) refreshList()};const t=setInterval(f,30000);window.addEventListener('focus',f);document.addEventListener('visibilitychange',f);return()=>{clearInterval(t);window.removeEventListener('focus',f);document.removeEventListener('visibilitychange',f)}},[refreshList])
  return <main><h1>Notifications</h1>{!usesMainBackend && <p>Delivery is asynchronous and may take a moment.</p>}<label><input type="checkbox" checked={unread} onChange={e=>{setUnread(e.target.checked);setPage(1)}}/> Unread only</label><Feedback action={action}/><Resource value={r} empty={unread ? "No unread notifications." : "Your inbox is empty."}><p>{r.meta?.unread_count} unread {usesMainBackend ? 'in recent notifications' : 'in total'}</p>{r.data?.map(n=><article className="panel" key={n.id}><h2>{n.title} {!n.read_at && '(Unread)'}</h2><p>{n.body}</p><p>{campusTime(n.created_at)} HKT</p>{n.event_id && <Link to={`/events/${n.event_id}`}>View event</Link>}{n.type === 'club_join_request' && <div className="row"><button disabled={action.busy} onClick={()=>action.run(`/clubs/${n.club_id}/join-requests/${n.join_request_id}/review`,'POST',{decision:'accept'},'Join request approved.')}>Approve request</button><button className="secondary-button" disabled={action.busy} onClick={()=>action.run(`/clubs/${n.club_id}/join-requests/${n.join_request_id}/review`,'POST',{decision:'reject'},'Join request rejected.')}>Reject request</button></div>} {!n.read_at && <button disabled={action.busy} onClick={()=>action.run(`/notifications/${n.id}/read`,'PATCH',{},'Marked as read.')}>Mark as read</button>}</article>)}<Pagination meta={r.meta} page={page} setPage={setPage}/></Resource></main>
}
