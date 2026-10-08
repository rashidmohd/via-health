import { useTranslation } from 'react-i18next'
import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { useLogout, useMe } from './api/auth'
import { LanguageSwitch } from './features/LanguageSwitch'
import { PlaceholderPage } from './features/PlaceholderPage'
import { EmailCodeForm } from './features/auth/EmailCodeForm'
import { NameStep } from './features/auth/NameStep'
import { NAV_ITEMS } from './features/nav'

export default function App() {
  const { t } = useTranslation()
  const { data: me, isPending, isError, refetch } = useMe()
  const logout = useLogout()

  if (isPending) {
    return <p className="center muted">{t('common.loading')}</p>
  }
  if (isError) {
    return (
      <div className="center">
        <p>{t('errors.network_error')}</p>
        <button className="secondary" onClick={() => void refetch()}>
          {t('common.retry')}
        </button>
      </div>
    )
  }
  if (!me) {
    return (
      <Routes>
        <Route path="/login" element={<EmailCodeForm mode="login" />} />
        <Route path="/signup" element={<EmailCodeForm mode="signup" />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }
  if (!me.display_name) {
    return <NameStep />
  }

  return (
    <div className="layout">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">Sessio</div>
        <ul>
          {NAV_ITEMS.map((item) => (
            <li key={item.key}>
              <NavLink to={item.path} end={item.path === '/'}>
                {t(`nav.${item.key}`)}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="sidebar-footer">
          <div className="user-name">{me.display_name}</div>
          <LanguageSwitch />
          <button className="link" onClick={() => logout.mutate()} disabled={logout.isPending}>
            {t('auth.signOut')}
          </button>
        </div>
      </nav>
      <main>
        <Routes>
          {NAV_ITEMS.map((item) => (
            <Route key={item.key} path={item.path} element={<PlaceholderPage navKey={item.key} />} />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
