import { useEffect, useState } from 'react'
import { NavLink } from 'react-router'
import '../App.css'

const empty_registration = {
  name: '',
  email: '',
  student_id: '',
  password: '',
  confirm_password: '',
}

function AccountPage({ onMembershipsRefresh, can_manage_venues }) {
  const [mode, set_mode] = useState('login')
  const [user, set_user] = useState(null)
  const [form, set_form] = useState(empty_registration)
  const [details_form, set_details_form] = useState({
    name: '',
    email: '',
  })
  const [password_form, set_password_form] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  })
  const [delete_form, set_delete_form] = useState({
    current_password: '',
    confirmation: '',
  })
  const [message, set_message] = useState('')
  const [message_type, set_message_type] = useState('')
  const [loading, set_loading] = useState(true)
  const [submitting, set_submitting] = useState(false)

  function show_error(text) {
    set_message(text)
    set_message_type('error')
  }

  function show_success(text) {
    set_message(text)
    set_message_type('success')
  }

  function clear_message() {
    set_message('')
    set_message_type('')
  }

  useEffect(() => {
    let active = true
    fetch('/api/auth/me')
      .then(async (response) => {
        if (response.status === 401) return null
        if (!response.ok) throw new Error('Could not load your account.')
        return response.json()
      })
      .then((current_user) => {
        if (active && current_user) {
          set_user(current_user)
          set_details_form({
            name: current_user.name,
            email: current_user.email,
          })
        }
      })
      .catch((error) => {
        if (active) show_error(error.message || 'Could not reach the server.')
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
    clear_message()
    if (mode === 'register' && form.password !== form.confirm_password) {
      show_error('Passwords do not match.')
      return
    }

    set_submitting(true)
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
        show_error(data.message || 'Could not sign in.')
        return
      }
      set_user(data)
      await onMembershipsRefresh()
      set_details_form({
        name: data.name,
        email: data.email,
      })
      set_form(empty_registration)
    } catch {
      show_error('Could not reach the server.')
    } finally {
      set_submitting(false)
    }
  }

  async function handle_update_details(event) {
    event.preventDefault()
    clear_message()
    set_submitting(true)
    try {
      const response = await fetch('/api/auth/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(details_form),
      })
      const data = response.status === 204 ? null : await response.json()
      if (!response.ok) {
        show_error(data.message || 'Could not update your account.')
        return
      }
      set_user(data)
      set_details_form({
        name: data.name,
        email: data.email,
      })
      show_success('Account details updated.')
    } catch {
      show_error('Could not reach the server.')
    } finally {
      set_submitting(false)
    }
  }

  async function handle_change_password(event) {
    event.preventDefault()
    clear_message()
    if (password_form.new_password !== password_form.confirm_password) {
      show_error('New passwords do not match.')
      return
    }

    set_submitting(true)
    try {
      const response = await fetch('/api/auth/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: user.name,
          email: user.email,
          current_password: password_form.current_password,
          new_password: password_form.new_password,
          confirm_password: password_form.confirm_password,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        show_error(data.message || 'Could not change your password.')
        return
      }
      set_user(data)
      set_password_form({
        current_password: '',
        new_password: '',
        confirm_password: '',
      })
      show_success('Password changed.')
    } catch {
      show_error('Could not reach the server.')
    } finally {
      set_submitting(false)
    }
  }

  async function handle_delete_account(event) {
    event.preventDefault()
    clear_message()
    if (delete_form.confirmation !== 'DELETE') {
      show_error('Type DELETE to confirm account deletion.')
      return
    }

    set_submitting(true)
    try {
      const response = await fetch('/api/auth/me', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: delete_form.current_password,
        }),
      })
      if (!response.ok) {
        const data = await response.json()
        show_error(data.message || 'Could not delete your account.')
        return
      }
      set_user(null)
      await onMembershipsRefresh()
      set_mode('login')
      set_form(empty_registration)
      set_details_form({ name: '', email: '' })
      set_password_form({
        current_password: '',
        new_password: '',
        confirm_password: '',
      })
      set_delete_form({ current_password: '', confirmation: '' })
      show_success('Your account and associated memberships and event signups were deleted.')
    } catch {
      show_error('Could not reach the server.')
    } finally {
      set_submitting(false)
    }
  }

  async function handle_logout() {
    clear_message()
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' })
      if (!response.ok) throw new Error('Could not log out.')
      set_user(null)
      await onMembershipsRefresh()
      set_mode('login')
      set_form(empty_registration)
      set_details_form({ name: '', email: '' })
      set_password_form({
        current_password: '',
        new_password: '',
        confirm_password: '',
      })
      set_delete_form({ current_password: '', confirmation: '' })
    } catch (error) {
      show_error(error.message || 'Could not reach the server.')
    }
  }

  function change_mode(next_mode) {
    set_mode(next_mode)
    set_form(empty_registration)
    clear_message()
  }

  return (
    <main>
      <header>
        <h1>ClubSpace</h1>
        <nav>
          <NavLink to="/events">Events</NavLink>
          {can_manage_venues && <NavLink to="/venues">Venues</NavLink>}
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

            <h3>Edit account details</h3>
            <form onSubmit={handle_update_details}>
              <label>
                Name
                <input
                  autoComplete="name"
                  maxLength={255}
                  required
                  value={details_form.name}
                  onChange={(event) =>
                    set_details_form((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Email
                <input
                  autoComplete="email"
                  maxLength={255}
                  required
                  type="email"
                  value={details_form.email}
                  onChange={(event) =>
                    set_details_form((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                />
              </label>
              <button type="submit" disabled={submitting}>
                Save details
              </button>
            </form>

            <h3>Change password</h3>
            <form onSubmit={handle_change_password}>
              <label>
                Current password
                <input
                  autoComplete="current-password"
                  maxLength={128}
                  required
                  type="password"
                  value={password_form.current_password}
                  onChange={(event) =>
                    set_password_form((current) => ({
                      ...current,
                      current_password: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                New password
                <input
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                  type="password"
                  value={password_form.new_password}
                  onChange={(event) =>
                    set_password_form((current) => ({
                      ...current,
                      new_password: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Confirm new password
                <input
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                  type="password"
                  value={password_form.confirm_password}
                  onChange={(event) =>
                    set_password_form((current) => ({
                      ...current,
                      confirm_password: event.target.value,
                    }))
                  }
                />
              </label>
              <button type="submit" disabled={submitting}>
                Change password
              </button>
            </form>

            <h3>Delete account</h3>
            <p>This permanently deletes your account, memberships, and event signups.</p>
            <form onSubmit={handle_delete_account}>
              <label>
                Current password
                <input
                  autoComplete="current-password"
                  maxLength={128}
                  required
                  type="password"
                  value={delete_form.current_password}
                  onChange={(event) =>
                    set_delete_form((current) => ({
                      ...current,
                      current_password: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Type DELETE to confirm
                <input
                  required
                  value={delete_form.confirmation}
                  onChange={(event) =>
                    set_delete_form((current) => ({
                      ...current,
                      confirmation: event.target.value,
                    }))
                  }
                />
              </label>
              <button type="submit" disabled={submitting}>
                Delete account permanently
              </button>
            </form>
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
              {mode === 'register' && (
                <label>
                  Confirm password
                  <input
                    autoComplete="new-password"
                    maxLength={128}
                    minLength={8}
                    name="confirm_password"
                    required
                    type="password"
                    value={form.confirm_password}
                    onChange={handle_change}
                  />
                </label>
              )}
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
        {message && (
          <p
            className={`message ${message_type === 'error' ? 'error-message' : ''}`}
            role={message_type === 'error' ? 'alert' : 'status'}
            aria-live="polite"
          >
            {message}
          </p>
        )}
      </section>
    </main>
  )
}

export default AccountPage
