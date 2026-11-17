import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { request, setCsrf } from '../api'
import { Feedback } from '../components/common'
import { useAction } from '../hooks/resources'

// The callback's failure redirects land here as ?error=<marker> (see
// google.js): one friendly sentence per marker, a generic one for anything
// unrecognized. Consumed on first render so a refresh does not re-show it.
const GOOGLE_ERRORS = {
  google_invalid_handshake: 'Your Google sign-in session expired or was already used. Start again from the sign-in page.',
  google_email_unverified: 'Your Google account has no verified email address, so ClubSpace cannot link it. Verify the email with Google and try again.',
  google_sign_in_busy: 'Another sign-in just touched your account. Wait a moment and try again.',
  google_email_linked_elsewhere: 'This Google account is already linked to a different ClubSpace account. Sign in with that account’s password instead.',
  google_unavailable: 'Google sign-in is not available right now. Please try again shortly, or use your email and password.',
}
const GOOGLE_ERROR_FALLBACK = 'Google sign-in failed. Please try again, or use your email and password.'

function useGoogleError() {
  // Derived once on mount from the URL: no state, no effect, and the param is
  // consumed immediately so a refresh does not re-show the message.
  const marker = new URLSearchParams(window.location.search).get('error')
  if (marker) window.history.replaceState({}, '', window.location.pathname)
  return marker ? (GOOGLE_ERRORS[marker] || GOOGLE_ERROR_FALLBACK) : null
}

export function AuthForm({ mode, onLogin }) { const navigate = useNavigate(); const location = useLocation(); const [form, setForm] = useState({ name: '', email: '', student_id: '', password: '' }); const action = useAction(); const register = mode === 'register'; const googleError = useGoogleError(); const [googleEnabled, setGoogleEnabled] = useState(false); useEffect(() => { request('/config').then(result => setGoogleEnabled(Boolean(result.data.google_oauth_enabled))).catch(() => {}) }, []); async function submit(e) { e.preventDefault(); const registration = form; const body = register ? registration : { email: form.email, password: form.password }; const result = await action.run(`/auth/${mode}`, 'POST', body, register ? 'Account created. Please sign in.' : 'Signed in.'); if (result && !register) { setCsrf(result.data.csrf_token); onLogin(result.data); const target = new URLSearchParams(location.search).get('return'); navigate(target?.startsWith('/') && !target.startsWith('//') ? target : '/events', { replace: true }) } }
  return <main className="auth-page"><div className="auth-brand"><span className="brand-mark" aria-hidden="true">C<span>✳</span></span><span>ClubSpace<small>YOUR CAMPUS, CONNECTED</small></span></div>{import.meta.env.MODE === 'fixtures' && <div className="preview-banner" role="status">Local preview · Sample data · Read-only</div>}<div className="auth-layout"><section className="auth-card"><h1>{register ? 'Create your account' : 'Welcome back'}</h1><p className="auth-subtitle">{register ? 'Join your campus community to get started.' : 'Sign in to find your people and your next event.'}</p>{googleError && <div role="alert" className="notice notice-error"><p>{googleError}</p></div>}{import.meta.env.MODE === 'fixtures' && !register && <details className="preview-credentials"><summary>Local preview credentials</summary><p>preview@clubspace.test<br/>preview12345</p></details>}<form onSubmit={submit} className="auth-form stack">{register && <><label>Name<input required maxLength={100} value={form.name} onChange={e => setForm({...form,name:e.target.value})}/></label><label>Student ID<input required value={form.student_id} onChange={e => setForm({...form,student_id:e.target.value})}/></label></>}<label>Email<input type="email" required value={form.email} onChange={e => setForm({...form,email:e.target.value})}/></label><label>Password<input type="password" required minLength={register ? 12 : 1} maxLength={128} value={form.password} onChange={e => setForm({...form,password:e.target.value})}/></label><Feedback action={action}/><button disabled={action.busy}>{register ? 'Register' : 'Sign in'}</button>{googleEnabled && <a className="cs-btn auth-google-button" href="/api/v1/auth/google/start">Continue with Google</a>}{googleEnabled && <p className="auth-switch">or continue with your email and password</p>}<p className="auth-switch">{register ? 'Already have an account? ' : 'New to ClubSpace? '}<Link to={register ? '/login' : '/register'}>{register ? 'Sign in' : 'Create an account'}</Link></p></form></section><section className="auth-intro"><h2>Good things happen <em>together.</em></h2><p>Find your community, discover what’s happening, and bring your next great idea to campus.</p><div className="intro-detail"><span aria-hidden="true">✳</span><div><strong>One place for your campus</strong><br/>Events, clubs, and spaces, all together.</div></div></section></div><footer className="auth-footer">Made for campus communities <span>✳</span> ClubSpace <span>✳</span> <Link to="/credits">Credits</Link></footer></main> }
