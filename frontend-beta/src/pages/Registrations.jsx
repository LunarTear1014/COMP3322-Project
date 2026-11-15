import { useState } from 'react'
import { Link } from 'react-router'
import { query, campusTime } from '../api'
import { Resource, Pagination } from '../components/common'
import { useResource } from '../hooks/resources'

export function Registrations() { const [status,setStatus]=useState(''); const [page,setPage]=useState(1); const r=useResource(`/me/registrations${query({status,page})}`); return <main><h1>My registrations</h1><label>Status<select value={status} onChange={e=>{setStatus(e.target.value);setPage(1)}}><option value="">All</option>{['joined','pending','unsuccessful'].map(x=><option key={x}>{x}</option>)}</select></label><Resource value={r} empty={<span>No registrations yet. <Link to="/events">Explore events</Link></span>}>{r.data?.map((x,i)=><article className="panel" key={x.event.id || i}><Link to={`/events/${x.event.id}`}>{x.event.title}</Link><p>{campusTime(x.event.start_at)} HKT · {x.status}{x.queue_position && ` · approximate queue position ${x.queue_position}`}</p></article>)}<Pagination meta={r.meta} page={page} setPage={setPage}/></Resource></main> }
