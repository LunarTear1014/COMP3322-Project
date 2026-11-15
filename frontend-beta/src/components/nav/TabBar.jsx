import { Link, useLocation } from 'react-router'
import { PRIMARY_TABS, badgeText, isActive } from './navigation'

// Bottom navigation below 768 px: four real links, the current one marked with
// aria-current and a filled pill (not colour alone). The Inbox badge is hidden
// at 0 and read out as "N unread".
export function TabBar({ unread = 0 }) {
  const { pathname } = useLocation()
  return (
    <nav className="cs-tabbar app-tabbar" aria-label="Main">
      {PRIMARY_TABS.map(tab => {
        const Icon = tab.icon
        const text = tab.badge ? badgeText(unread) : undefined
        return (
          <Link key={tab.to} to={tab.to} className="cs-tab" aria-current={isActive(tab, pathname) ? 'page' : undefined}>
            <Icon className="cs-icon" aria-hidden="true" />
            {tab.label}
            {text && <span className="cs-badge"><span aria-hidden="true">{text}</span><span className="cs-sr">, {unread} unread</span></span>}
          </Link>
        )
      })}
    </nav>
  )
}
