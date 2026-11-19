import { Link } from 'react-router'

// Privacy policy and terms of use, linked from the Google OAuth consent screen
// (Google Auth Platform → Branding) and from the sign-in footer. Both are
// public. Keep them in step with what the backend stores: users table
// (name, email, student ID, password hash, google_sub), sessions, club and
// event activity, uploaded covers, audit rows and capped container logs.

const UPDATED = '18 November 2026'
const REPOSITORY = 'https://github.com/LunarTear1014/PG19-ClubSpace'

function BackLink({ signedIn }) {
  return <p><Link to={signedIn ? '/events' : '/login'}>{signedIn ? 'Back to Explore' : 'Back to sign in'}</Link></p>
}

export function PrivacyPolicy({ signedIn }) {
  return (
    <main className="page legal-page">
      <h1>Privacy policy</h1>
      <p className="cs-meta">Last updated {UPDATED}</p>
      <p>
        ClubSpace is a student project for the COMP3322 course at the University of Hong Kong, built and run by
        Group 19. It runs on a course server that is only reachable through HKUVPN. This page explains what
        ClubSpace stores about you and why.
      </p>

      <section className="legal-section" aria-labelledby="privacy-collect">
        <h2 id="privacy-collect" className="section-title">What we store</h2>
        <ul>
          <li><strong>Your account:</strong> your name, email address and student ID, and a hash of your password if you set one. We never store the password itself.</li>
          <li><strong>Google sign-in:</strong> if you choose Continue with Google, Google tells us your Google account ID, your email address (only if Google has verified it) and your name. We use them to create or find your ClubSpace account. We do not receive your Google password, and we do not keep Google access tokens or read anything else in your Google account.</li>
          <li><strong>What you do in ClubSpace:</strong> clubs you join, events you create, view, register for and check in to, venue requests, notifications, and the cover images you upload (with their photo metadata removed).</li>
          <li><strong>Records kept for safety:</strong> a log of committee and administrator actions, and short web server logs that include IP addresses. Logs are capped in size and the oldest entries are overwritten.</li>
        </ul>
      </section>

      <section className="legal-section" aria-labelledby="privacy-cookies">
        <h2 id="privacy-cookies" className="section-title">Cookies</h2>
        <p>
          ClubSpace sets one cookie, <code>clubspace.sid</code>, to keep you signed in. It expires after 24 hours.
          There are no advertising or analytics cookies.
        </p>
      </section>

      <section className="legal-section" aria-labelledby="privacy-use">
        <h2 id="privacy-use" className="section-title">How we use and share it</h2>
        <p>
          We use this information only to run ClubSpace: to sign you in, show you clubs and events, and let club
          committees and venue administrators manage them. Club committees can see the names of their members and of
          people who register for their events. We do not sell your information, share it with anyone outside the
          course, or use it for advertising. ClubSpace does not send emails; reminders appear in its own inbox.
        </p>
      </section>

      <section className="legal-section" aria-labelledby="privacy-storage">
        <h2 id="privacy-storage" className="section-title">Where it is kept</h2>
        <p>
          Everything is stored in a MySQL database and on disk on the Group 19 course server provided by HKU, with
          database backups on the same server. Course staff who mark the project may see the data while doing so.
        </p>
      </section>

      <section className="legal-section" aria-labelledby="privacy-choices">
        <h2 id="privacy-choices" className="section-title">Your choices</h2>
        <p>
          You can update your name, email address and student ID on your profile page, and leave clubs or cancel registrations at
          any time. To have your account and its data deleted, or to ask what we hold about you, contact the Group 19
          team through the <a href={REPOSITORY} target="_blank" rel="noreferrer">project repository</a>. You can also
          remove ClubSpace's access from your Google account settings at any time.
        </p>
      </section>

      <p>See also the <Link to="/terms">terms of use</Link>.</p>
      <BackLink signedIn={signedIn} />
    </main>
  )
}

export function Terms({ signedIn }) {
  return (
    <main className="page legal-page">
      <h1>Terms of use</h1>
      <p className="cs-meta">Last updated {UPDATED}</p>
      <p>
        ClubSpace is a student project for the COMP3322 course at the University of Hong Kong, built and run by
        Group 19 for teaching and demonstration. By using it you agree to these terms.
      </p>

      <section className="legal-section" aria-labelledby="terms-service">
        <h2 id="terms-service" className="section-title">The service</h2>
        <ul>
          <li>ClubSpace is provided as it is, free of charge, with no guarantee that it is available, correct or kept running after the course ends.</li>
          <li>Events, clubs and venues shown are demonstration data unless a real club says otherwise. Do not rely on ClubSpace for real bookings.</li>
          <li>The site may be reset at any time, which deletes accounts, events and uploads.</li>
        </ul>
      </section>

      <section className="legal-section" aria-labelledby="terms-conduct">
        <h2 id="terms-conduct" className="section-title">Your conduct</h2>
        <ul>
          <li>Use your own account and keep your password to yourself.</li>
          <li>Only upload images you have the right to use, and do not post anything unlawful, abusive or misleading.</li>
          <li>Do not try to break, overload or get around the security of the site or the course server.</li>
        </ul>
        <p>We may remove content or close accounts that break these terms.</p>
      </section>

      <section className="legal-section" aria-labelledby="terms-contact">
        <h2 id="terms-contact" className="section-title">Questions</h2>
        <p>
          Contact the Group 19 team through the <a href={REPOSITORY} target="_blank" rel="noreferrer">project repository</a>.
          How we handle your information is described in the <Link to="/privacy">privacy policy</Link>.
        </p>
      </section>

      <BackLink signedIn={signedIn} />
    </main>
  )
}
