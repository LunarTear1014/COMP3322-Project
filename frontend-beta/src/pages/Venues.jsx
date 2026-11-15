import { Link } from 'react-router'
import { PageHeading, Resource } from '../components/common'
import { useAllOptions } from '../hooks/resources'

export function Venues() { const r=useAllOptions('/venues'); return <main><PageHeading title="Venues" description="Find a space for your next gathering."/><Resource value={r} empty="No venues available."><div className="grid">{r.data?.map(v=><article className="panel" key={v.id}><h2>{v.name}</h2><p>{v.location} · Capacity {v.capacity}</p><p>{v.description}</p><p>{v.is_active?'Active':'Unavailable'}</p><Link to={`/venues/${v.id}/calendar`}>View calendar</Link></article>)}</div></Resource></main> }
