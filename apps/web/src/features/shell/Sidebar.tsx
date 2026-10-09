import { LogOut, Mic, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink } from 'react-router-dom'
import { useLogout, type Me } from '../../api/auth'
import { useNotifications } from '../../api/notifications'
import { confirmDialog } from '../../design/confirm'
import { Initials } from '../../design/Initials'
import { Logo } from '../../design/Logo'
import { getActiveRecorder, stopActiveRecording } from '../../recorder/active'
import { LanguageSwitch } from '../LanguageSwitch'
import { NAV_GROUPS, NAV_ICONS, NAV_ITEMS } from '../nav'
import { SyncBadge } from '../sessions/SyncBadge'

export function Sidebar({ me, onClose }: { me: Me; onClose: () => void }) {
  const { t } = useTranslation()
  const logout = useLogout()

  async function signOut() {
    if (getActiveRecorder()) {
      const confirmed = await confirmDialog({
        message: t('record.signOutConfirm'),
        confirmLabel: t('record.stopAndSignOut'),
      })
      if (!confirmed) return
      await stopActiveRecording()
    }
    logout.mutate()
  }

  return (
    <aside className="sidebar" id="sidebar">
      <div className="sidebar-top">
        <Link to="/" className="brand">
          <Logo />
        </Link>
        <button type="button" className="icon-button bare sidebar-close" onClick={onClose} aria-label={t('shell.closeMenu')}>
          <X className="icon" aria-hidden="true" />
        </button>
      </div>

      <Link className="button primary sidebar-cta" to="/sessions/new">
        <Mic className="icon" aria-hidden="true" />
        {t('sessions.start')}
      </Link>

      <nav aria-label={t('shell.mainNav')}>
        {NAV_GROUPS.map((group) => (
          <div className="nav-group" key={group}>
            <p className="eyebrow nav-group-label">{t(`shell.group.${group}`)}</p>
            <ul>
              {NAV_ITEMS.filter((item) => item.group === group).map((item) => {
                const Icon = NAV_ICONS[item.key]
                return (
                  <li key={item.key}>
                    <NavLink to={item.path} end={item.path === '/'}>
                      <Icon className="icon" aria-hidden="true" />
                      <span className="nav-label">{t(`nav.${item.key}`)}</span>
                      {item.key === 'notifications' && <UnreadCount />}
                    </NavLink>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <SyncBadge />
        <div className="user-card">
          <div className="user-ident">
            <Initials name={me.display_name} />
            <div className="user-text">
              <span className="user-name">{me.display_name}</span>
              <span className="user-email">{me.email}</span>
            </div>
          </div>
          <div className="user-actions">
            <LanguageSwitch />
            <button
              type="button"
              className="icon-button bare"
              onClick={() => void signOut()}
              disabled={logout.isPending}
              aria-label={t('auth.signOut')}
              title={t('auth.signOut')}
            >
              <LogOut className="icon" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}

function UnreadCount() {
  const { t } = useTranslation()
  const { data } = useNotifications()
  if (!data?.unread) return null
  return (
    <span className="nav-count" aria-label={t('notifications.unreadCount', { count: data.unread })}>
      {data.unread > 99 ? '99+' : data.unread}
    </span>
  )
}
