import { Bell, Menu } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
import { useNotifications } from '../../api/notifications'
import { NAV_ITEMS, type NavKey } from '../nav'

type Crumb = { label: string; to?: string }

/** Detail-level crumbs, keyed by the last path segment (ids fall back to "details"). */
const DETAIL_CRUMBS = ['new', 'record', 'consent', 'report'] as const

function useCrumbs(pathname: string): Crumb[] {
  const { t } = useTranslation()
  const segments = pathname.split('/').filter(Boolean)
  const section: NavKey =
    NAV_ITEMS.find((item) => item.path !== '/' && item.path === `/${segments[0]}`)?.key ?? 'today'
  const sectionPath = NAV_ITEMS.find((item) => item.key === section)!.path
  const crumbs: Crumb[] = [{ label: t(`nav.${section}`), to: sectionPath }]

  if (segments.length > 1) {
    const last = segments[segments.length - 1]
    const detail = (DETAIL_CRUMBS as readonly string[]).includes(last) ? last : 'details'
    // /sessions/record/:clientId → "Recording"
    const key = segments[1] === 'record' ? 'record' : detail
    crumbs.push({ label: t(`shell.crumb.${key}`) })
  }
  crumbs[crumbs.length - 1].to = undefined
  return crumbs
}

export function Topbar({ navOpen, onMenu }: { navOpen: boolean; onMenu: () => void }) {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const crumbs = useCrumbs(pathname)
  const { data } = useNotifications()
  const unread = data?.unread ?? 0

  return (
    <header className="topbar">
      <button
        type="button"
        className="icon-button menu-button"
        onClick={onMenu}
        aria-label={t('shell.openMenu')}
        aria-expanded={navOpen}
        aria-controls="sidebar"
      >
        <Menu className="icon" aria-hidden="true" />
      </button>
      <nav className="breadcrumbs" aria-label={t('shell.breadcrumb')}>
        <ol>
          {crumbs.map((crumb) => (
            <li key={crumb.label}>
              {crumb.to ? (
                <Link to={crumb.to}>{crumb.label}</Link>
              ) : (
                <span aria-current="page">{crumb.label}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <div className="topbar-actions">
        <Link
          to="/notifications"
          className="icon-button"
          aria-label={t('nav.notifications')}
          title={t('nav.notifications')}
        >
          <Bell className="icon" aria-hidden="true" />
          {unread > 0 && <span className="dot-count" />}
        </Link>
      </div>
    </header>
  )
}
