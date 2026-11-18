import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { PageHeading, Resource, Feedback } from '../components/common'
import { Button, StatusChip, TextField, useToast } from '../components/ui'
import { useResource, useAllOptions, useAction } from '../hooks/resources'
import { clubColour } from '../lib/club'

const ROLE_LABEL = { president: 'President', committee: 'Committee', member: 'Member' }

// Account details. Joining and leaving clubs lives in the Clubs tab.
export function Profile({ session, refreshSession }) {
  const profile = useResource('/profile')
  const memberships = useAllOptions('/me/memberships')
  const toast = useToast()
  const [form, setForm] = useState(null)

  useEffect(() => {
    if (profile.data) setForm(current => current || { name: profile.data.name, email: profile.data.email })
  }, [profile.data])

  const refresh = () => { profile.refresh(); memberships.refresh(); refreshSession() }
  const action = useAction(refresh)

  async function save(event) {
    event.preventDefault()
    const result = await action.run('/profile', 'PATCH', form)
    if (result) toast.show({ message: 'Profile saved.' })
  }

  return (
    <main className="page narrow">
      <PageHeading title="Profile" description="Your account details and the clubs you belong to." />
      <Resource value={profile}>
        {form && profile.data && (
          <form className="profile-form" onSubmit={save}>
            <TextField label="Name" name="name" autoComplete="name" required maxLength={100} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} />
            <TextField label="Email" name="email" type="email" autoComplete="email" spellCheck={false} required value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} />
            <p className="cs-meta">Student ID: {profile.data.student_id ?? '—'} · Role: {session.user.platform_role === 'venue_admin' ? 'Venue administrator' : 'Student'}</p>
            <Button variant="primary" type="submit" busy={action.busy}>Save profile</Button>
          </form>
        )}
      </Resource>
      <Feedback action={action} />

      <h2 className="section-title">Your clubs</h2>
      <Resource value={memberships} allowEmpty>
        {memberships.data?.length ? (
          <ul className="stack-list">
            {memberships.data.map(item => (
              <li key={item.club_id} className="membership-row" style={{ '--club': clubColour(item.club_id).cssVar }}>
                <span className="cs-club"><i aria-hidden="true" /><span>{item.name || item.club_name}</span></span>
                <StatusChip state="joined" label={ROLE_LABEL[item.role] || 'Member'} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="cs-meta">You haven’t joined a club yet.</p>
        )}
        <p><Link to="/clubs">Join or leave clubs</Link></p>
      </Resource>
    </main>
  )
}
