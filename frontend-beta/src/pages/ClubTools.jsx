import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ErrorNotice, PageHeading, Resource } from '../components/common'
import { Button, StatusChip, useToast } from '../components/ui'
import { useAction, useAllOptions } from '../hooks/resources'
import { isOrganizer } from '../lib/roles'

const ROLE = { president: 'President', committee: 'Committee', member: 'Member' }

// Club tools for committee members and presidents on the v1 provider.
export function ClubTools({ session }) {
  const clubs = session.memberships.filter(isOrganizer)
  return (
    <main className="page">
      <PageHeading title="Your clubs" description="Members, roles and reports for the clubs you run." />
      <div className="card-grid">
        {clubs.map(club => (
          <article key={club.club_id} className="cs-card is-flat">
            <div className="cs-card-body">
              <h2 className="cs-card-title">{club.club_name}</h2>
              <StatusChip state="joined" label={ROLE[club.role]} />
              <p><Link to={`/organizer/clubs/${club.club_id}/members`}>Members and roles</Link></p>
              <p><Link to={`/organizer/clubs/${club.club_id}/reports/effectiveness`}>Event effectiveness</Link></p>
            </div>
          </article>
        ))}
      </div>
    </main>
  )
}

function MemberRow({ member, mine, onChange, busy }) {
  const [confirming, setConfirming] = useState(false)
  const president = mine === 'president'
  return (
    <li className="member-row">
      <span className="member-name">{member.user.name}</span>
      <StatusChip state="joined" label={ROLE[member.role]} />
      {president && member.role === 'member' && (
        <Button disabled={busy} aria-label={`Appoint ${member.user.name} to the committee`} onClick={() => onChange(member, 'committee')}>Appoint to committee</Button>
      )}
      {president && member.role === 'committee' && (
        confirming ? (
          <span className="inline-confirm" role="group" aria-label={`Transfer the presidency to ${member.user.name}`}>
            <span>Make {member.user.name} president? You become a committee member.</span>
            <Button variant="danger" busy={busy} onClick={() => { setConfirming(false); onChange(member, 'president') }}>Transfer presidency</Button>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
          </span>
        ) : (
          <>
            <Button disabled={busy} aria-label={`Remove ${member.user.name} from the committee`} onClick={() => onChange(member, 'member')}>Remove from committee</Button>
            <Button disabled={busy} aria-label={`Make ${member.user.name} president`} onClick={() => setConfirming(true)}>Make president</Button>
          </>
        )
      )}
    </li>
  )
}

export function ClubMembers({ session, refreshSession }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const members = useAllOptions(`/clubs/${id}/members`)
  const mine = session.memberships.find(item => String(item.club_id) === id)?.role
  const action = useAction(() => { members.refresh(); refreshSession?.() })

  async function change(member, role) {
    if (role === 'president') {
      const result = await action.run(`/clubs/${id}/presidency`, 'POST', { to_user_id: member.user.id, expected_version: member.version })
      if (result) { toast.show({ message: `${member.user.name} is now president.` }); navigate('/organizer/club-tools') }
      return
    }
    const result = await action.run(`/clubs/${id}/members/${member.user.id}`, 'PATCH', { role, expected_version: member.version })
    if (result) toast.show({ message: role === 'committee' ? `${member.user.name} joined the committee.` : `${member.user.name} is a member again.` })
  }

  return (
    <main className="page">
      <PageHeading title="Members and roles" description={mine === 'president' ? 'Appoint committee members, remove them, or hand over the presidency.' : 'Only the president can change roles.'} />
      <ErrorNotice error={action.error} />
      <Resource value={members} empty="No members yet.">
        <ul className="stack-list">
          {members.data?.map(member => <MemberRow key={member.user.id} member={member} mine={mine} busy={action.busy} onChange={change} />)}
        </ul>
      </Resource>
    </main>
  )
}
