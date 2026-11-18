import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { setCsrf } from '../api'
import { Feedback } from '../components/common'
import { useAction, useResource } from '../hooks/resources'
import { GOOGLE_ERRORS, GOOGLE_ERROR_FALLBACK } from '../lib/googleAuth'
import { Button } from '../components/ui'

// The callback's failure redirects land here as ?error=<marker> (see
// google.js and lib/googleAuth.js): the friendly sentence is looked up per
// marker, and the param is consumed in an effect so a refresh does not
// re-show it.
function useGoogleError() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [marker, setMarker] = useState(null)

  useEffect(() => {
    const m = searchParams.get('error')
    if (m) {
      setMarker(m)
      // Consume the marker so a refresh does not re-show it.
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  return marker ? (GOOGLE_ERRORS[marker] || GOOGLE_ERROR_FALLBACK) : null
}

export function AuthForm({ mode, onLogin }) { const navigate = useNavigate(); const location = useLocation(); const [form, setForm] = useState({ name: '', email: '', student_id: '', password: '' }); const action = useAction(); const register = mode === 'register'; const googleError = useGoogleError(); const config = useResource('/config'); const googleEnabled = Boolean(config.data?.google_oauth_enabled); async function submit(e) { e.preventDefault(); const registration = form; const body = register ? registration : { email: form.email, password: form.password }; const result = await action.run(`/auth/${mode}`, 'POST', body, register ? 'Account created. Please sign in.' : 'Signed in.'); if (result && !register) { setCsrf(result.data.csrf_token); onLogin(result.data); const target = new URLSearchParams(location.search).get('return'); navigate(target?.startsWith('/') && !target.startsWith('//') ? target : '/events', { replace: true }) } }
  return <main className="auth-page"><div className="auth-brand"><span className="brand-mark" aria-hidden="true">C<span>✳</span></span><span>ClubSpace<small>YOUR CAMPUS, CONNECTED</small></span></div>{import.meta.env.MODE === 'fixtures' && <div className="preview-banner" role="status">Local preview · Sample data · Read-only</div>}<div className="auth-layout"><section className="auth-card"><h1>{register ? 'Create your account' : 'Welcome back'}</h1><p className="auth-subtitle">{register ? 'Join your campus community to get started.' : 'Sign in to find your people and your next event.'}</p>{googleError && <div role="alert" className="notice notice-error"><p>{googleError}</p></div>}{import.meta.env.MODE === 'fixtures' && !register && <details className="preview-credentials"><summary>Local preview credentials</summary><p>preview@clubspace.test<br/>preview12345</p></details>}<form onSubmit={submit} className="auth-form stack">{register && <><label>Name<input required maxLength={100} value={form.name} onChange={e => setForm({...form,name:e.target.value})}/></label><label>Student ID<input required value={form.student_id} onChange={e => setForm({...form,student_id:e.target.value})}/></label></>}<label>Email<input type="email" required value={form.email} onChange={e => setForm({...form,email:e.target.value})}/></label><label>Password<input type="password" required minLength={register ? 12 : 1} maxLength={128} value={form.password} onChange={e => setForm({...form,password:e.target.value})}/></label><Feedback action={action}/><div className="auth-buttons-stack"><Button variant="primary" type="submit" busy={action.busy} block>{register ? 'Register' : 'Sign in'}</Button>{googleEnabled && <> <div className="auth-divider" role="separator" aria-label="or">OR</div> <a className="cs-btn cs-btn-surface cs-btn-block auth-google-button" href="/api/auth/google/start"><svg className="google-logo" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>Continue with Google</a> </>}</div><p className="auth-switch">{register ? 'Already have an account? ' : 'New to ClubSpace? '}<Link to={register ? '/login' : '/register'}>{register ? 'Sign in' : 'Create an account'}</Link></p></form></section><section className="auth-intro"><h2>Good things happen <em>together.</em></h2><p>Find your community, discover what’s happening, and bring your next great idea to campus.</p><div className="intro-detail"><span aria-hidden="true">✳</span><div><strong>One place for your campus</strong><br/>Events, clubs, and spaces, all together.</div></div></section></div><footer className="auth-footer">Made for campus communities <span>✳</span> ClubSpace <span>✳</span> <Link to="/credits">Credits</Link></footer></main> }
