import { Link, useLocation } from 'react-router'
import { AccountMenu } from './AccountMenu'
import { badgeText, headerLinks, isActive } from './navigation'

// Top bar. From 768 px up it also carries the primary links (plus Organizer for organizers); on phones
// those move to the TabBar and the header keeps just the brand and the account.
export function AppHeader({ session, unread, showLinks, onSignOut }) {
  const { pathname } = useLocation()
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link className="cs-brand" to="/events">
          <img src="/favicon.svg" width="40" height="40" alt="" />
          <span>ClubSpace</span>
        </Link>
        {showLinks && (
          <nav className="header-links" aria-label="Main">
            {headerLinks(session).map(tab => {
              const text = tab.badge ? badgeText(unread) : undefined
              return (
                <Link key={tab.to} to={tab.to} className="header-link" aria-current={isActive(tab, pathname) ? 'page' : undefined}>
                  {tab.label}
                  {text && <span className="nav-badge"><span aria-hidden="true">{text}</span><span className="cs-sr">, {unread} unread</span></span>}
                </Link>
              )
            })}
          </nav>
        )}
        <AccountMenu session={session} onSignOut={onSignOut} organizerInMenu={!showLinks} />
      </div>
    </header>
  )
}
