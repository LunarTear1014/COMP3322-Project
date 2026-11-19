import { useState } from 'react'
import { Link } from 'react-router'
import { PageHeading, Resource, Feedback } from '../components/common'
import { Button, ButtonLink, EmptyState, StatusChip, useToast } from '../components/ui'
import { useAction, useAllOptions } from '../hooks/resources'
import { clubColour } from '../lib/club'
import { isOrganizer } from '../lib/roles'

function ClubCard({ club, membership, busy, onJoin, onLeave, onWithdraw }) {
  const [confirming, setConfirming] = useState(false)
  const colour = clubColour(club.id)
  const organizer = membership && isOrganizer(membership)
  const pending = club.request_status === 'pending'
  return (
    <article className="cs-card has-actions" style={{ '--club': colour.cssVar }}>
      <div className="cs-clubhead"><span className="cs-clubbadge" aria-hidden="true">{[...club.name][0]}</span></div>
      <div className="cs-card-body">
        <h3 className="cs-card-title">{club.name}</h3>
        {(club.member_count != null || club.event_count != null) && (
          <span className="cs-meta cs-nums">
            {club.member_count != null && `${club.member_count} members`}
            {club.member_count != null && club.event_count != null && ' · '}
            {club.event_count != null && `${club.event_count} events this month`}
          </span>
        )}
        {club.description && <p className="clamp-2">{club.description}</p>}
        {confirming ? (
          <div className="inline-confirm" role="group" aria-label={`Leave ${club.name}`}>
            <p>Leave {club.name}? To join again you’ll send a new request, and the committee has to approve it.</p>
            <div className="cs-row">
              <Button variant="danger" busy={busy} onClick={() => { setConfirming(false); onLeave(club) }}>Leave club</Button>
              <Button onClick={() => setConfirming(false)}>Stay in club</Button>
            </div>
          </div>
        ) : (
          <div className="cs-card-actions">
            {organizer ? (
              <>
                <StatusChip state="joined" label={membership.role === 'president' ? 'President' : 'Committee'} />
                <Link className="cs-btn" to="/organizer/clubs">Manage club</Link>
              </>
            ) : membership ? (
              <>
                <StatusChip state="joined" label="Member" />
                <Button disabled={busy} onClick={() => setConfirming(true)}>Leave</Button>
              </>
            ) : pending ? (
              <>
                <StatusChip state="pending" label="Join request pending" />
                <Button disabled={busy} onClick={() => onWithdraw(club)} aria-label={`Cancel join request for ${club.name}`}>Cancel request</Button>
              </>
            ) : (
              <>
                <span className="cs-meta">Not a member</span>
                <Button disabled={busy} onClick={() => onJoin(club)}>Request to join</Button>
              </>
            )}
          </div>
        )}
        {organizer && <p className="cs-meta">Committee members leave from the club management page.</p>}
      </div>
    </article>
  )
}

// Clubs tab: the viewer's clubs first, then every other club with its join action.
export function ClubsDirectory({ refreshSession }) {
  const clubs = useAllOptions('/clubs')
  const memberships = useAllOptions('/me/memberships')
  const toast = useToast()
  const action = useAction(() => { clubs.refresh(); memberships.refresh(); refreshSession?.() })

  async function join(club) {
    const result = await action.run(`/clubs/${club.id}/membership`, 'PUT', {})
    // Both providers send a request; a current member gets their membership back.
    if (result) toast.show({ message: result.data?.role ? `You’re a member of ${club.name}.` : `Request sent to ${club.name}.` })
  }
  // Withdraws a pending request; the committee can no longer approve it (CLUB-06).
  async function withdraw(club) {
    const result = await action.run(`/clubs/${club.id}/membership`, 'DELETE', {})
    if (result) toast.show({ message: `Your request to join ${club.name} was cancelled.`, tone: 'info' })
  }
  async function leave(club) {
    const result = await action.run(`/clubs/${club.id}/membership`, 'DELETE', {})
    if (result) toast.show({ message: `You left ${club.name}.`, tone: 'info' })
  }

  const membershipFor = id => memberships.data?.find(item => item.club_id === id)
  const mine = (clubs.data || []).filter(club => membershipFor(club.id))
  const others = (clubs.data || []).filter(club => !membershipFor(club.id))

  return (
    <main className="page">
      <PageHeading title="Clubs" description="Find your people. Join a club to register for its members-only events." />
      <Feedback action={action} />
      <Resource value={clubs} allowEmpty>
        <Resource value={memberships} allowEmpty>
          {clubs.data?.length === 0 ? (
            <EmptyState title="No clubs yet" actions={<ButtonLink to="/events">Explore events</ButtonLink>}>Clubs will appear here as soon as they are added.</EmptyState>
          ) : (
            <>
              <section aria-labelledby="your-clubs">
                <h2 id="your-clubs" className="section-title">Your clubs</h2>
                {mine.length ? (
                  <div className="card-grid">{mine.map(club => <ClubCard key={club.id} club={club} membership={membershipFor(club.id)} busy={action.busy} onJoin={join} onLeave={leave} onWithdraw={withdraw} />)}</div>
                ) : (
                  <p className="cs-meta">You haven’t joined a club yet. Pick one below.</p>
                )}
              </section>
              <section aria-labelledby="discover-clubs">
                <h2 id="discover-clubs" className="section-title">Discover clubs</h2>
                {others.length ? (
                  <div className="card-grid">{others.map(club => <ClubCard key={club.id} club={club} busy={action.busy} onJoin={join} onLeave={leave} onWithdraw={withdraw} />)}</div>
                ) : (
                  <p className="cs-meta">You’re in every club. Nice.</p>
                )}
              </section>
            </>
          )}
        </Resource>
      </Resource>
    </main>
  )
}
