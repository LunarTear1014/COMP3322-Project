import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { campusTime, query } from '../api'
import { ErrorNotice, PageHeading, Pagination, Resource } from '../components/common'
import { Button, StatusChip, TextField, useToast } from '../components/ui'
import { useAction, useAllOptions, useResource } from '../hooks/resources'
import { isOrganizer } from '../lib/roles'

const ROLE = { president: 'President', committee: 'Committee', member: 'Member' }

// The clubs a committee member or president runs: members, reports, and
// stepping down from the committee.
export function ClubTools({ session, refreshSession }) {
  const clubs = session.memberships.filter(isOrganizer)
  const toast = useToast()
  const [confirming, setConfirming] = useState(null)
  const action = useAction(() => refreshSession?.())

  async function leaveCommittee(club) {
    const result = await action.run(`/clubs/${club.club_id}/committee`, 'DELETE', {})
    setConfirming(null)
    if (result) toast.show({ message: `You left the ${club.club_name} committee and remain a member.` })
  }

  return (
    <main className="page">
      <PageHeading title="Your clubs" description="Members, roles and reports for the clubs you run." />
      <ErrorNotice error={action.error} />
      <div className="card-grid">
        {clubs.map(club => (
          <article key={club.club_id} className="cs-card is-flat">
            <div className="cs-card-body">
              <h2 className="cs-card-title">{club.club_name}</h2>
              <StatusChip state="joined" label={ROLE[club.role]} />
              <p><Link to={`/organizer/clubs/${club.club_id}/members`}>Members and roles</Link></p>
              <p><Link to={`/organizer/clubs/${club.club_id}/reports`}>Activity report</Link></p>
              <p><Link to={`/organizer/clubs/${club.club_id}/reports/effectiveness`}>Event effectiveness</Link></p>
              {club.role === 'committee' && (confirming === club.club_id ? (
                <div className="inline-confirm" role="group" aria-label={`Leave the ${club.club_name} committee`}>
                  <p>Leave the committee? You stay a member, and only the president can appoint you again.</p>
                  <div className="cs-row">
                    <Button variant="danger" busy={action.busy} onClick={() => leaveCommittee(club)}>Leave committee</Button>
                    <Button onClick={() => setConfirming(null)}>Stay on committee</Button>
                  </div>
                </div>
              ) : (
                <Button disabled={action.busy} onClick={() => setConfirming(club.club_id)}>Leave committee</Button>
              ))}
              {club.role === 'president' && <p className="cs-meta">Hand over the presidency from Members and roles before you step down.</p>}
            </div>
          </article>
        ))}
      </div>
    </main>
  )
}

function MemberRow({ member, mine, onChange, onRemove, busy, self }) {
  const [confirming, setConfirming] = useState(null)
  const president = mine === 'president'
  const name = member.user.name
  if (confirming === 'president') {
    return (
      <li className="member-row">
        <span className="inline-confirm" role="group" aria-label={`Transfer the presidency to ${name}`}>
          <span>Make {name} president? You become a committee member.</span>
          <Button variant="danger" busy={busy} onClick={() => { setConfirming(null); onChange(member, 'president') }}>Transfer presidency</Button>
          <Button onClick={() => setConfirming(null)}>Cancel</Button>
        </span>
      </li>
    )
  }
  if (confirming === 'remove') {
    return (
      <li className="member-row">
        <span className="inline-confirm" role="group" aria-label={`Remove ${name} from the club`}>
          <span>Remove {name} from the club? Their places at members-only events end. The president can undo this.</span>
          <Button variant="danger" busy={busy} onClick={() => { setConfirming(null); onRemove(member) }}>Remove from club</Button>
          <Button onClick={() => setConfirming(null)}>Keep member</Button>
        </span>
      </li>
    )
  }
  return (
    <li className="member-row">
      <span className="member-name">{name}</span>
      <StatusChip state="joined" label={ROLE[member.role]} />
      {president && member.role === 'member' && (
        <Button disabled={busy} aria-label={`Appoint ${name} to the committee`} onClick={() => onChange(member, 'committee')}>Appoint to committee</Button>
      )}
      {president && member.role === 'committee' && (
        <>
          <Button disabled={busy} aria-label={`Remove ${name} from the committee`} onClick={() => onChange(member, 'member')}>Remove from committee</Button>
          <Button disabled={busy} aria-label={`Make ${name} president`} onClick={() => setConfirming('president')}>Make president</Button>
        </>
      )}
      {mine && mine !== 'member' && member.role === 'member' && !self && (
        <Button disabled={busy} aria-label={`Remove ${name} from the club`} onClick={() => setConfirming('remove')}>Remove from club</Button>
      )}
    </li>
  )
}

// The president's log of role, membership and join-request actions, with undo.
function ActionLog({ clubId, refresh }) {
  const [page, setPage] = useState(1)
  const toast = useToast()
  const log = useResource(`/clubs/${clubId}/actions${query({ page })}`)
  const action = useAction(() => { log.refresh(); refresh() })
  async function undo(item) {
    const result = await action.run(`/clubs/${clubId}/actions/${item.id}/undo`, 'POST', {})
    if (result) toast.show({ message: 'Action undone. Affected members were notified.' })
  }
  return (
    <section className="action-log" aria-labelledby="action-log-title">
      <h2 id="action-log-title" className="section-title">Club activity log</h2>
      <ErrorNotice error={action.error} />
      <Resource value={log} empty="No club actions have been recorded yet.">
        <ul className="stack-list">
          {log.data?.map(item => (
            <li key={item.id} className="action-log-entry">
              <p><strong>{item.actor.name}</strong> · {item.description}</p>
              {item.target && <p className="cs-meta">Affected member: {item.target.name}</p>}
              <p className="cs-meta">{campusTime(item.created_at)} HKT{item.undone_at ? ' · Undone' : ''}</p>
              {item.undoable && <Button disabled={action.busy} aria-label={`Undo: ${item.description}`} onClick={() => undo(item)}>Undo</Button>}
            </li>
          ))}
        </ul>
        <Pagination meta={log.meta} page={page} setPage={setPage} />
      </Resource>
    </section>
  )
}

export function ClubMembers({ session, refreshSession }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [search, setSearch] = useState('')
  const members = useAllOptions(`/clubs/${id}/members`)
  const mine = session.memberships.find(item => String(item.club_id) === id)?.role
  const refresh = () => { members.refresh(); refreshSession?.() }
  const action = useAction(refresh)
  const shown = (members.data ?? []).filter(member => member.user.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))

  async function change(member, role) {
    if (role === 'president') {
      const result = await action.run(`/clubs/${id}/presidency`, 'POST', { to_user_id: member.user.id, expected_version: member.version })
      if (result) { toast.show({ message: `${member.user.name} is now president.` }); navigate('/organizer/clubs') }
      return
    }
    const result = await action.run(`/clubs/${id}/members/${member.user.id}`, 'PATCH', { role, expected_version: member.version })
    if (result) toast.show({ message: role === 'committee' ? `${member.user.name} joined the committee.` : `${member.user.name} is a member again.` })
  }

  async function remove(member) {
    const result = await action.run(`/clubs/${id}/members/${member.user.id}`, 'DELETE', {})
    if (result) toast.show({ message: `${member.user.name} was removed from the club.`, tone: 'info' })
  }

  return (
    <main className="page">
      <PageHeading title="Members and roles" description={mine === 'president' ? 'Appoint committee members, remove them, or hand over the presidency.' : 'Only the president can change roles. Committee members can remove plain members.'} />
      <ErrorNotice error={action.error} />
      <Resource value={members} empty="No members yet.">
        <TextField label="Search members" type="search" name="member-search" value={search} onChange={event => setSearch(event.target.value)} />
        <ul className="stack-list">
          {shown.map(member => <MemberRow key={member.user.id} member={member} mine={mine} self={member.user.id === session.user.id} busy={action.busy} onChange={change} onRemove={remove} />)}
        </ul>
        {members.data && !shown.length && <p role="status">No members match “{search}”.</p>}
      </Resource>
      {mine === 'president' && <ActionLog clubId={id} refresh={refresh} />}
    </main>
  )
}
