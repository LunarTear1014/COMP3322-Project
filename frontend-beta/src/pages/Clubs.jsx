import { useState } from 'react'
import { useNavigate } from 'react-router'
import { campusTime } from '../api'
import { isOrganizer } from '../lib/roles'
import { PageHeading, Resource, Feedback } from '../components/common'
import { useResource, useAllOptions, useAction } from '../hooks/resources'

export function Clubs({ refreshSession }) {
  const memberships = useAllOptions('/me/memberships')
  const refresh = () => {
    memberships.refresh()
    refreshSession()
  }
  const clubs = (memberships.data || []).filter(isOrganizer)

  return <main>
    <PageHeading title="Your clubs" description="Manage the club roles attached to your account."/>
    <Resource value={memberships} empty="You are not a committee member or president of any clubs.">
      <div className="grid">{clubs.map(club => <ClubCard key={club.club_id} club={club} refresh={refresh}/>)}</div>
    </Resource>
  </main>
}
export function ClubCard({ club, refresh }) {
  const clubName = club.name || club.club_name
  const members = useResource(`/clubs/${club.club_id}/members`)
  const actionLog = useResource(club.role === 'president' ? `/clubs/${club.club_id}/actions` : null)
  const action = useAction(() => {
    refresh()
    members.refresh()
    actionLog.refresh()
  })
  const navigate = useNavigate()
  const [targetId, setTargetId] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [memberSearch, setMemberSearch] = useState('')
  const committeeMembers = (members.data || []).filter(member => member.role === 'committee')
  const regularMembers = (members.data || []).filter(member => member.role === 'member')
  const filteredMembers = (members.data || []).filter(member => member.name.toLocaleLowerCase().includes(memberSearch.trim().toLocaleLowerCase()))

  async function leaveCommittee() {
    const result = await action.run(
      `/clubs/${club.club_id}/committee`,
      'DELETE',
      {},
      `You left the ${clubName} committee and remain a member.`,
    )
    if (result) navigate('/profile')
  }

  async function transferPresidency(event) {
    event.preventDefault()
    await action.run(
      `/clubs/${club.club_id}/presidency`,
      'POST',
      { user_id: Number(targetId), confirmation },
      `Presidency of ${clubName} transferred.`,
    )
  }

  async function promoteMember(member) {
    await action.run(
      `/clubs/${club.club_id}/members/${member.user_id}/committee`,
      'POST',
      {},
      `${member.name} was promoted to the ${clubName} committee.`,
    )
  }

  async function demoteMember(member) {
    await action.run(
      `/clubs/${club.club_id}/members/${member.user_id}/committee`,
      'DELETE',
      {},
      `${member.name} was returned to regular member status.`,
    )
  }

  async function removeMember(member) {
    await action.run(
      `/clubs/${club.club_id}/members/${member.user_id}`,
      'DELETE',
      {},
      `${member.name} was removed from ${clubName}.`,
    )
  }

  return <article className="panel stack">
    <h2>{clubName}</h2>
    <p>{club.description || 'No description available.'}</p>
    <p>Your role: {club.role}</p>
    <Feedback action={action}/>
    <section className="stack">
      <details className="club-member-disclosure">
        <summary>Club members{members.data && ` (${members.data.length})`}</summary>
        <Resource value={members} empty="There are no members in this club yet.">
          {!!members.data?.length && <label className="club-member-search">Search {clubName} members
            <input type="search" value={memberSearch} onChange={event => setMemberSearch(event.target.value)} placeholder="Enter a member name"/>
          </label>}
          <div className="club-member-list-container">
            <ul className="club-member-list">{filteredMembers.map(member => <li key={member.user_id}>
              <span>{member.name} · {member.role}</span>
              {member.role === 'member' && <button className="secondary-button" disabled={action.busy} onClick={() => promoteMember(member)}>Make committee</button>}
              {member.role === 'member' && <button className="secondary-button" disabled={action.busy} onClick={() => removeMember(member)}>Remove {member.name} from club</button>}
              {club.role === 'president' && member.role === 'committee' && <button className="secondary-button" disabled={action.busy} onClick={() => demoteMember(member)}>Demote {member.name} to member</button>}
            </li>)}</ul>
            {members.data && !filteredMembers.length && <p role="status">No members match “{memberSearch}”.</p>}
            {members.data && !regularMembers.length && !memberSearch && <p>There are no regular members to promote.</p>}
          </div>
        </Resource>
      </details>
    </section>
    {club.role === 'committee'
      ? <><p>Leaving the committee keeps you as a regular club member. You can leave the club from your profile afterward.</p><button disabled={action.busy} onClick={leaveCommittee}>Leave committee</button></>
      : <section className="stack">
        <h3 className="club-action-heading">Transfer presidency</h3>
        <p>Choose an existing committee member. After transfer, you will remain on the committee.</p>
        <Resource value={members} empty="Promote a club member to the committee before transferring the presidency.">
          {!!committeeMembers.length && <form className="stack" onSubmit={transferPresidency}>
            <label>New president<select required value={targetId} onChange={event => setTargetId(event.target.value)}>
              <option value="">Choose a committee member</option>
              {committeeMembers.map(member => <option key={member.user_id} value={member.user_id}>{member.name}</option>)}
            </select></label>
            <label>Type “{clubName}” to confirm<input required value={confirmation} onChange={event => setConfirmation(event.target.value)}/></label>
            <button disabled={action.busy || !targetId || confirmation !== clubName}>Transfer presidency</button>
          </form>}
        </Resource>
        <details className="club-member-disclosure">
          <summary>Club activity log</summary>
          <Resource value={actionLog} empty="No club actions have been recorded yet.">
            <div className="club-action-log">
              {actionLog.data?.map(item => <article className="club-action-log-entry" key={item.id}>
                <p><strong>{item.actor_name}</strong> · {item.description}</p>
                {item.target_name && <p>Affected member: {item.target_name}</p>}
                <p>{campusTime(item.created_at)} HKT{item.undone_at ? ' · Undone' : ''}</p>
                {item.undoable && !item.undone_at && <button className="secondary-button" disabled={action.busy} onClick={() => action.run(
                  `/clubs/${club.club_id}/actions/${item.id}/undo`,
                  'POST',
                  {},
                  'Action undone. Affected members have been notified.',
                )}>Undo action</button>}
                {!item.undoable && <p>This action has related effects and cannot be safely undone.</p>}
              </article>)}
            </div>
          </Resource>
        </details>
      </section>}
  </article>
}
