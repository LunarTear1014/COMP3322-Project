import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { campusTime, query } from '../api'
import { dateLabel } from '../lib/format'
import { ErrorNotice, PageHeading, Pagination, Resource } from '../components/common'
import { Button, StatusChip, TextField, useToast } from '../components/ui'
import { ClubIconEditor } from '../components/ClubIconEditor'
import { ClubBanner } from '../components/ClubBanner'
import { CoverUploader } from '../components/CoverUploader'
import { iconForm } from '../lib/clubIcon'
import { PHOTO_HELP, photoForm, photoProblem } from '../lib/clubPhoto'
import { clubColour } from '../lib/club'
import { useAction, useAllOptions, useResource } from '../hooks/resources'
import { useNotificationSignal } from '../hooks/useLiveSignal'
import { RemovalDecision } from '../components/RemovalDecision'
import { REMOVAL_NOTES, decideRemoval } from '../components/RemovalQueue'
import { isOrganizer } from '../lib/roles'

const ROLE = { president: 'President', committee: 'Committee', member: 'Member' }
const ROLE_ORDER = { president: 0, committee: 1, member: 2 }

// The clubs a committee member or president runs: members, reports, and
// stepping down from the committee.
export function ClubTools({ session, refreshSession }) {
  const clubs = session.memberships.filter(isOrganizer)
  const toast = useToast()
  const [confirming, setConfirming] = useState(null)
  const action = useAction(() => refreshSession?.())
  const iconAction = useAction(() => refreshSession?.())
  const [iconClub, setIconClub] = useState(null)
  const photoAction = useAction(() => refreshSession?.())
  const [photoClub, setPhotoClub] = useState(null)
  const [photoOpen, setPhotoOpen] = useState(null)

  async function leaveCommittee(club) {
    const result = await action.run(`/clubs/${club.club_id}/committee`, 'DELETE', {})
    setConfirming(null)
    if (result) toast.show({ message: `You left the ${club.club_name} committee and remain a member.` })
  }

  async function saveIcon(club, file) {
    setIconClub(club.club_id)
    const result = await iconAction.run(`/clubs/${club.club_id}/icon`, 'PUT', iconForm(file))
    if (result) toast.show({ message: `${club.club_name} icon saved.` })
    return Boolean(result)
  }
  async function removeIcon(club) {
    setIconClub(club.club_id)
    const result = await iconAction.run(`/clubs/${club.club_id}/icon`, 'DELETE', {})
    if (result) toast.show({ message: `${club.club_name} icon removed.`, tone: 'info' })
  }
  async function savePhoto(club, { file, alt }) {
    setPhotoClub(club.club_id)
    const result = await photoAction.run(`/clubs/${club.club_id}/photo`, 'PUT', photoForm({ file, alt }))
    if (result) { toast.show({ message: `${club.club_name} photo saved.` }); setPhotoOpen(null) }
  }
  async function removePhoto(club) {
    setPhotoClub(club.club_id)
    const result = await photoAction.run(`/clubs/${club.club_id}/photo`, 'DELETE', {})
    if (result) { toast.show({ message: `${club.club_name} photo removed.`, tone: 'info' }); setPhotoOpen(null) }
  }
  const photoError = club => (photoAction.error && photoClub === club.club_id ? photoAction.error.fields?.file || photoAction.error.fields?.alt || photoAction.error.message : '')
  const iconError = club => (iconAction.error && iconClub === club.club_id ? iconAction.error.fields?.file || iconAction.error.message : '')

  return (
    <main className="page">
      <PageHeading title="Your clubs" description="Members, roles and reports for the clubs you run." />
      <ErrorNotice error={action.error} />
      <div className="card-grid">
        {clubs.map(club => (
          <article key={club.club_id} className="cs-card is-flat has-actions" style={{ '--club': clubColour(club.club_id).cssVar }}>
            <ClubBanner name={club.club_name} icon={club.club_icon} photo={club.club_photo} />
            <div className="cs-card-body">
              <h2 className="cs-card-title">{club.club_name}</h2>
              <StatusChip state="joined" label={ROLE[club.role]} />
              {photoOpen === club.club_id ? (
                <>
                  <CoverUploader
                    kind="photo" help={PHOTO_HELP} check={photoProblem} accept="image/jpeg,image/png,image/webp"
                    title={`${club.club_name} members`} current={club.club_photo}
                    busy={photoAction.busy && photoClub === club.club_id} serverError={photoError(club)}
                    onSave={upload => savePhoto(club, upload)} onRemove={() => removePhoto(club)}
                  />
                  <Button onClick={() => setPhotoOpen(null)}>Close photo editor</Button>
                </>
              ) : (
                <Button aria-label={`${club.club_photo ? 'Change' : 'Add'} the ${club.club_name} photo`} aria-expanded="false" onClick={() => { photoAction.reset?.(); setPhotoOpen(club.club_id) }}>
                  {club.club_photo ? 'Change club photo' : 'Add club photo'}
                </Button>
              )}
              <ClubIconEditor clubName={club.club_name} current={club.club_icon} busy={iconAction.busy && iconClub === club.club_id} serverError={iconError(club)} onSave={file => saveIcon(club, file)} onRemove={() => removeIcon(club)} />
              <p><Link to={`/organizer/clubs/${club.club_id}/members`}>Members and roles</Link></p>
              <p><Link to={`/organizer/clubs/${club.club_id}/members#action-log-title`}>Activity log</Link></p>
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

// One table row per member. A confirmation (make president, remove) replaces
// the row's buttons in the Actions cell, so it stays next to the person it is about.
function MemberRow({ member, mine, onChange, onRemove, onAskRemoval, onWithdraw, onDecide, request, viewerId, busy, self }) {
  const [confirming, setConfirming] = useState(null)
  const [reason, setReason] = useState('')
  const president = mine === 'president'
  const name = member.user.name
  let actions = null
  if (confirming === 'president') {
    actions = (
      <div className="inline-confirm member-confirm" role="group" aria-label={`Transfer the presidency to ${name}`}>
        <span>Make {name} president? You become a committee member.</span>
        <div className="cs-row">
          <Button variant="danger" busy={busy} onClick={() => { setConfirming(null); onChange(member, 'president') }}>Transfer presidency</Button>
          <Button onClick={() => setConfirming(null)}>Cancel</Button>
        </div>
      </div>
    )
  } else if (confirming === 'remove' && !president) {
    actions = (
      <form className="inline-confirm member-confirm" aria-label={`Ask the president to remove ${name}`} onSubmit={async event => { event.preventDefault(); setConfirming(null); await onAskRemoval(member, reason.trim()); setReason('') }}>
        <span>Ask the president to remove {name}? Nothing changes until the president approves, and {name} is not told about the request.</span>
        <TextField label="Reason" optional hint="The president sees this." maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
        <div className="cs-row">
          <Button variant="primary" type="submit" busy={busy}>Send request</Button>
          <Button type="button" onClick={() => { setConfirming(null); setReason('') }}>Cancel</Button>
        </div>
      </form>
    )
  } else if (confirming === 'remove') {
    actions = (
      <div className="inline-confirm member-confirm" role="group" aria-label={`Remove ${name} from the club`}>
        <span>Remove {name} from the club? Their places at members-only events end. The president can undo this.</span>
        <div className="cs-row">
          <Button variant="danger" busy={busy} onClick={() => { setConfirming(null); onRemove(member) }}>Remove from club</Button>
          <Button onClick={() => setConfirming(null)}>Keep member</Button>
        </div>
      </div>
    )
  } else {
    const buttons = []
    if (president && member.role === 'member') {
      buttons.push(<Button key="appoint" disabled={busy} aria-label={`Appoint ${name} to the committee`} onClick={() => onChange(member, 'committee')}>Appoint to committee</Button>)
    }
    if (president && member.role === 'committee') {
      buttons.push(<Button key="demote" disabled={busy} aria-label={`Remove ${name} from the committee`} onClick={() => onChange(member, 'member')}>Remove from committee</Button>)
      buttons.push(<Button key="president" disabled={busy} aria-label={`Make ${name} president`} onClick={() => setConfirming('president')}>Make president</Button>)
    }
    const removable = mine && mine !== 'member' && member.role === 'member' && !self
    if (request && president) {
      buttons.push(<RemovalDecision key="decide" name={name} busy={busy} onDecide={(decision, why) => onDecide(request, decision, why)} />)
    }
    if (request && request.requested_by?.id === viewerId) {
      buttons.push(<Button key="withdraw" disabled={busy} aria-label={`Withdraw the removal request for ${name}`} onClick={() => onWithdraw(request)}>Withdraw request</Button>)
    }
    if (removable && president) {
      buttons.push(<Button key="remove" disabled={busy} aria-label={`Remove ${name} from the club`} onClick={() => setConfirming('remove')}>Remove from club</Button>)
    }
    if (removable && !president && !request) {
      buttons.push(<Button key="ask" disabled={busy} aria-label={`Request removal of ${name}`} onClick={() => setConfirming('remove')}>Request removal</Button>)
    }
    actions = buttons.length ? <div className="cs-row">{buttons}</div> : <span className="cs-meta" aria-label="No actions available">—</span>
  }
  return (
    <tr>
      <th scope="row" className="member-name">{name}{self && <span className="cs-meta"> (you)</span>}</th>
      <td><StatusChip state="joined" label={ROLE[member.role]} /></td>
      <td className="cs-nums">{member.joined_at ? dateLabel(member.joined_at) : '—'}</td>
      <td className="member-actions">
        {request && (
          <div className="removal-pending">
            <StatusChip state="awaiting_president" label="Removal pending" />
            {(president || request.requested_by?.id === viewerId) && request.requested_by && <p className="cs-meta">Asked by {request.requested_by.id === viewerId ? 'you' : request.requested_by.name}{request.reason ? `: ${request.reason}` : ''}</p>}
          </div>
        )}
        {actions}
      </td>
    </tr>
  )
}

// The committee's log of role, membership and join-request actions. Only the
// president is offered Undo (the API sends undoable: false to everyone else).
function ActionLog({ clubId, refresh, changes, canUndo }) {
  const [page, setPage] = useState(1)
  const toast = useToast()
  const log = useResource(`/clubs/${clubId}/actions${query({ page })}`)
  const refreshLog = log.refresh
  // Role and membership changes made above add log rows (F06).
  useEffect(() => { if (changes) refreshLog() }, [changes, refreshLog])
  const action = useAction(() => { log.refresh(); refresh() })
  async function undo(item) {
    const result = await action.run(`/clubs/${clubId}/actions/${item.id}/undo`, 'POST', {})
    if (result) toast.show({ message: 'Action undone. Affected members were notified.' })
  }
  // Arriving from "Activity log" (#action-log-title) brings the log into view.
  const { hash } = useLocation()
  const heading = useRef(null)
  useEffect(() => {
    if (hash === '#action-log-title' && heading.current) { heading.current.scrollIntoView?.({ block: 'start' }); heading.current.focus({ preventScroll: true }) }
  }, [hash])
  return (
    <section className="action-log" aria-labelledby="action-log-title">
      <h2 id="action-log-title" ref={heading} tabIndex={-1} className="section-title">Club activity log</h2>
      {!canUndo && <p className="cs-meta">Only the president can undo actions.</p>}
      <ErrorNotice error={action.error} />
      <Resource value={log} empty="No club actions have been recorded yet.">
        <ul className="stack-list">
          {log.data?.map(item => (
            <li key={item.id} className="action-log-entry">
              <p><strong>{item.actor.name}</strong> · {item.description}</p>
              {item.target && <p className="cs-meta">Affected member: {item.target.name}</p>}
              <p className="cs-meta">{campusTime(item.created_at)} HKT{item.undone_at ? ' · Undone' : ''}</p>
              {canUndo && item.undoable && <Button disabled={action.busy} aria-label={`Undo: ${item.description}`} onClick={() => undo(item)}>Undo</Button>}
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
  const removals = useAllOptions(`/clubs/${id}/removal-requests`)
  const mine = session.memberships.find(item => String(item.club_id) === id)?.role
  const [changes, setChanges] = useState(0)
  const refresh = () => { members.refresh(); removals.refresh(); refreshSession?.(); setChanges(count => count + 1) }
  const action = useAction(refresh)
  // A role or membership change made in another session refreshes the roster,
  // the log and this user's own controls (F08).
  useNotificationSignal(note => ['role_changed', 'club_membership', 'club_join_request', ...REMOVAL_NOTES].includes(note?.type) && String(note.club_id) === id, () => {
    members.refresh()
    removals.refresh()
    setChanges(count => count + 1)
  })
  // President first, then the committee, then members; alphabetical within a role.
  const shown = (members.data ?? [])
    .filter(member => member.user.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a, b) => (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3) || a.user.name.localeCompare(b.user.name))

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

  // Committee members ask; the president decides.
  async function askRemoval(member, reason) {
    const result = await action.run(`/clubs/${id}/members/${member.user.id}`, 'DELETE', reason ? { reason } : {})
    if (result) toast.show({ message: `Asked the president to remove ${member.user.name}. Nothing changes until they approve.`, tone: 'info' })
  }
  async function withdraw(request) {
    const result = await action.run(`/clubs/${id}/removal-requests/${request.id}`, 'DELETE', {})
    if (result) toast.show({ message: `Withdrew the request to remove ${request.user.name}.`, tone: 'info' })
  }
  async function decide(request, decision, reason) {
    const result = await decideRemoval(action, id, request, decision, reason)
    if (result) toast.show({ message: decision === 'approve' ? `${request.user.name} was removed from the club.` : `${request.user.name} stays in the club.`, tone: 'info' })
  }
  const pendingByUser = new Map((removals.data ?? []).map(request => [request.user.id, request]))

  return (
    <main className="page">
      <PageHeading title="Members and roles" description={mine === 'president' ? 'Appoint committee members, remove them, or hand over the presidency.' : 'Only the president can change roles. Committee members can ask the president to remove plain members.'} />
      <ErrorNotice error={action.error} />
      <Resource value={members} empty="No members yet.">
        <TextField label="Search members" type="search" name="member-search" value={search} onChange={event => setSearch(event.target.value)} />
        {shown.length > 0 && (
          <div className="cs-tablewrap members-table" role="region" aria-label="Club members" tabIndex={0}>
            <table className="cs-table">
              <caption className="cs-sr">President, committee and members of this club</caption>
              <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Joined</th><th scope="col">Actions</th></tr></thead>
              <tbody>
                {shown.map(member => <MemberRow key={member.user.id} member={member} mine={mine} self={member.user.id === session.user.id} viewerId={session.user.id} request={pendingByUser.get(member.user.id)} busy={action.busy} onChange={change} onRemove={remove} onAskRemoval={askRemoval} onWithdraw={withdraw} onDecide={decide} />)}
              </tbody>
            </table>
          </div>
        )}
        {members.data && !shown.length && <p role="status">No members match “{search}”.</p>}
      </Resource>
      <ActionLog clubId={id} canUndo={mine === 'president'} refresh={() => { members.refresh(); refreshSession?.() }} changes={changes} />
    </main>
  )
}
