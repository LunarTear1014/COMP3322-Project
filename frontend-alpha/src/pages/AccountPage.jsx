import { useEffect, useState } from 'react'
import { NavLink } from 'react-router'
import '../App.css'

function AccountPage() {
  const [mode, set_mode] = useState('login')
  const [user, set_user] = useState(null)
  const [form, set_form] = useState({
    name: '',
    email: '',
    student_id: '',
    password: '',
  })
  const [message, set_message] = useState('')
  const [loading, set_loading] = useState(true)
  const [submitting, set_submitting] = useState(false)

  useEffect(() => {
    let active = true
    fetch('/api/auth/me')
      .then(async (response) => {
        if (response.status === 401) return null
        if (!response.ok) throw new Error('Could not load your account.')
        return response.json()
      })
      .then((current_user) => {
        if (active) set_user(current_user)
      })
      .catch((error) => {
        if (active) set_message(error.message || 'Could not reach the server.')
      })
      .finally(() => {
        if (active) set_loading(false)
      })

    return () => {
      active = false
    }
  }, [])

  function handle_change(event) {
    set_form((current_form) => ({
      ...current_form,
      [event.target.name]: event.target.value,
    }))
  }

  async function handle_submit(event) {
    event.preventDefault()
    set_submitting(true)
    set_message('')
    try {
      const response = await fetch(
        mode === 'login' ? '/api/auth/login' : '/api/auth/register',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        },
      )
      const data = await response.json()
      if (!response.ok) {
        set_message(data.message || 'Could not sign in.')
        return
      }
      set_user(data)
      set_form((current_form) => ({ ...current_form, password: '' }))
    } catch {
      set_message('Could not reach the server.')
    } finally {
      set_submitting(false)
    }
  }

  async function handle_logout() {
    set_message('')
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' })
      if (!response.ok) throw new Error('Could not log out.')
      set_user(null)
      set_mode('login')
    } catch (error) {
      set_message(error.message || 'Could not reach the server.')
    }
  }

  function change_mode(next_mode) {
    set_mode(next_mode)
    set_message('')
  }

  return (
    <main>
      <header>
        <h1>ClubSpace</h1>
        <nav>
          <NavLink to="/events">Events</NavLink>
          <NavLink to="/profile">Profile</NavLink>
          <NavLink to="/venues">Venues</NavLink>
          <NavLink to="/clubs">Clubs</NavLink>
          <NavLink to="/account">Account</NavLink>
        </nav>
      </header>

      <section className="panel auth-panel">
        <p>Account</p>
        {loading ? (
          <p>Checking your account…</p>
        ) : user ? (
          <>
            <h2>Signed in</h2>
            <p>{user.name}</p>
            <p>{user.email}</p>
            <p>Student ID: {user.student_id}</p>
            <button type="button" onClick={handle_logout}>Log out</button>
          </>
        ) : (
          <>
            <h2>{mode === 'login' ? 'Log in' : 'Create an account'}</h2>
            <form onSubmit={handle_submit}>
              {mode === 'register' && (
                <>
                  <label>
                    Full name
                    <input
                      autoComplete="name"
                      maxLength={255}
                      name="name"
                      required
                      value={form.name}
                      onChange={handle_change}
                    />
                  </label>
                  <label>
                    Student ID
                    <input
                      maxLength={50}
                      name="student_id"
                      required
                      value={form.student_id}
                      onChange={handle_change}
                    />
                  </label>
                </>
              )}
              <label>
                Email
                <input
                  autoComplete="email"
                  maxLength={255}
                  name="email"
                  required
                  type="email"
                  value={form.email}
                  onChange={handle_change}
                />
              </label>
              <label>
                Password
                <input
                  autoComplete={
                    mode === 'login' ? 'current-password' : 'new-password'
                  }
                  maxLength={128}
                  minLength={mode === 'register' ? 8 : undefined}
                  name="password"
                  required
                  type="password"
                  value={form.password}
                  onChange={handle_change}
                />
                {mode === 'register' && (
                  <span className="field-hint">At least 8 characters.</span>
                )}
              </label>
              <button type="submit" disabled={submitting}>
                {submitting
                  ? 'Please wait…'
                  : mode === 'login'
                    ? 'Log in'
                    : 'Create account'}
              </button>
            </form>
            <p className="auth-switch">
              {mode === 'login' ? 'New to ClubSpace?' : 'Already registered?'}
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  change_mode(mode === 'login' ? 'register' : 'login')
                }
              >
                {mode === 'login' ? 'Create an account' : 'Log in'}
              </button>
            </p>
          </>
        )}
        {message && <p className="message">{message}</p>}
      </section>
    </main>
  )
}

export default AccountPage
