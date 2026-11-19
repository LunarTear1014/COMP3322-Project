import { Link } from 'react-router'

// Credits for third-party code, fonts and icons (COMP3322 project guideline,
// section 8). Versions and licences are the ones in package.json and each
// package's own licence field. Keep this list in step with the dependencies.

const FRONTEND = [
  { name: 'React and React DOM', use: 'User interface library', licence: 'MIT', url: 'https://react.dev/' },
  { name: 'React Router', use: 'Page routing in the single-page app', licence: 'MIT', url: 'https://reactrouter.com/' },
  { name: 'MUI Material UI', use: 'Base components behind the charts', licence: 'MIT', url: 'https://mui.com/material-ui/' },
  { name: 'MUI X Charts', use: 'Bar charts in the activity and effectiveness reports', licence: 'MIT', url: 'https://mui.com/x/react-charts/' },
  { name: 'Emotion', use: 'Styling engine required by MUI', licence: 'MIT', url: 'https://emotion.sh/' },
  { name: 'Lucide', use: 'Icons throughout the app (lucide-react)', licence: 'ISC', url: 'https://lucide.dev/' },
]

const FONTS = [
  { name: 'Bricolage Grotesque', use: 'Headings and display text', licence: 'SIL Open Font License 1.1', url: 'https://fonts.google.com/specimen/Bricolage+Grotesque' },
  { name: 'Lexend', use: 'Body text', licence: 'SIL Open Font License 1.1', url: 'https://fonts.google.com/specimen/Lexend' },
]

const BACKEND = [
  { name: 'Node.js and Express', use: 'REST API server', licence: 'MIT', url: 'https://expressjs.com/' },
  { name: 'express-session', use: 'Signed-in sessions', licence: 'MIT', url: 'https://github.com/expressjs/session' },
  { name: 'mysql2', use: 'MySQL client', licence: 'MIT', url: 'https://github.com/sidorares/node-mysql2' },
  { name: 'Multer', use: 'Event cover uploads', licence: 'MIT', url: 'https://github.com/expressjs/multer' },
  { name: 'sharp', use: 'Resizing cover images and removing their metadata', licence: 'Apache-2.0', url: 'https://sharp.pixelplumbing.com/' },
  { name: 'dotenv', use: 'Local configuration', licence: 'BSD-2-Clause', url: 'https://github.com/motdotla/dotenv' },
  { name: 'openid-client', use: 'Google sign-in (OpenID Connect)', licence: 'MIT', url: 'https://github.com/panva/openid-client' },
  { name: 'MySQL 8.4', use: 'Database', licence: 'GPL-2.0 (Community Edition)', url: 'https://www.mysql.com/' },
]

const TOOLS = [
  { name: 'Vite', use: 'Frontend build and dev server', licence: 'MIT', url: 'https://vite.dev/' },
  { name: 'Vitest and Testing Library', use: 'Frontend tests', licence: 'MIT', url: 'https://vitest.dev/' },
  { name: 'Oxlint', use: 'Linting', licence: 'MIT', url: 'https://oxc.rs/' },
  { name: 'Docker and nginx', use: 'Deployment and the web server in front of the API', licence: 'Apache-2.0 / BSD-2-Clause', url: 'https://docs.docker.com/compose/' },
]

function CreditList({ title, items }) {
  return (
    <section className="credits-section" aria-labelledby={`credits-${title}`}>
      <h2 id={`credits-${title}`} className="section-title">{title}</h2>
      <ul className="credits-list">
        {items.map(item => (
          <li key={item.name}>
            <a href={item.url} target="_blank" rel="noreferrer">{item.name}</a>
            <span className="cs-meta"> · {item.use} · {item.licence}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

// Reachable signed in or out, from the account menu and the sign-in footer.
export function Credits({ signedIn }) {
  return (
    <main className="page credits-page">
      <h1>Credits</h1>
      <p>
        ClubSpace is a COMP3322 Group 19 project. It builds on the open-source projects and fonts below, each used
        through its published package under the licence shown. We thank their authors.
      </p>
      <CreditList title="Frontend libraries" items={FRONTEND} />
      <CreditList title="Fonts" items={FONTS} />
      <CreditList title="Backend and database" items={BACKEND} />
      <CreditList title="Build, test and deployment tools" items={TOOLS} />
      <section className="credits-section" aria-labelledby="credits-images">
        <h2 id="credits-images" className="section-title">Images</h2>
        <p>
          The demo club and event cover images were generated with OpenAI&apos;s GPT image generation for ClubSpace&apos;s
          fictional demo data. They are not taken from stock libraries or other websites, and the people shown are not
          real.
        </p>
      </section>
      <p>See also the <Link to="/privacy">privacy policy</Link> and <Link to="/terms">terms of use</Link>.</p>
      <p><Link to={signedIn ? '/events' : '/login'}>{signedIn ? 'Back to Explore' : 'Back to sign in'}</Link></p>
    </main>
  )
}
