import { useState } from 'react'
import { PageHeading, Feedback } from '../components/common'
import { Button, TextField } from '../components/ui'
import { useAction } from '../hooks/resources'
import { STUDENT_ID } from '../lib/validation'

// Profile Completion (ADR-0001): a Google-signed-in user whose row still has a
// null student_id supplies it once before entering the app. Rendered in place
// of the routes while `session.user.student_id` is null, so no other route can
// be reached until the PATCH succeeds and `refreshSession()` clears the gate.
export function ProfileCompletion({ session, refreshSession }) {
  const [studentId, setStudentId] = useState('')
  const action = useAction(refreshSession)

  async function save(event) {
    event.preventDefault()
    const result = await action.run('/profile', 'PATCH', { student_id: studentId.trim() }, 'Profile completed.')
    if (result) refreshSession()
  }

  return (
    <main className="page narrow">
      <PageHeading
        title="Complete your profile"
        description={`Welcome, ${session.user.name}. Add your student ID to finish setting up your ClubSpace account.`}
      />
      <form className="profile-form" onSubmit={save}>
        <TextField
          label="Student ID"
          name="student_id"
          autoComplete="off"
          spellCheck={false}
          required
          maxLength={STUDENT_ID.max}
          value={studentId}
          onChange={event => setStudentId(event.target.value)}
        />
        <p className="cs-meta cs-hint">{STUDENT_ID.patternMessage}</p>
        <Feedback action={action} />
        <Button variant="primary" type="submit" busy={action.busy}>Save and continue</Button>
      </form>
    </main>
  )
}
