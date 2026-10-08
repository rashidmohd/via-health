import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { useLogout, useMe } from './api/auth'
import { LanguageSwitch } from './features/LanguageSwitch'
import { PlaceholderPage } from './features/PlaceholderPage'
import { EmailCodeForm } from './features/auth/EmailCodeForm'
import { ClientPage } from './features/clients/ClientPage'
import { ClientsPage } from './features/clients/ClientsPage'
import { ConsentPage } from './features/clients/ConsentPage'
import { NewClientPage } from './features/clients/NewClientPage'
import { NameStep } from './features/auth/NameStep'
import { NAV_ITEMS } from './features/nav'
import { ReportPage } from './features/reports/ReportPage'
import { RecordPage } from './features/sessions/RecordPage'
import { SessionPage } from './features/sessions/SessionPage'
import { RecoveryBanner } from './features/sessions/RecoveryBanner'
import { SessionsPage } from './features/sessions/SessionsPage'
import { StartSessionPage } from './features/sessions/StartSessionPage'
import { SyncBadge } from './features/sessions/SyncBadge'
import { TodayPage } from './features/today/TodayPage'
import { startSync } from './recorder/sync'
import { Logo } from './design/Logo'

export default function App() {
  const { t } = useTranslation()
  const { data: me, isPending, isError, refetch } = useMe()
  const logout = useLogout()
  const loggedIn = Boolean(me)

  useEffect(() => (loggedIn ? startSync() : undefined), [loggedIn])

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
        <div className="brand">
          <Logo />
        </div>
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
          <SyncBadge />
          <div className="user-name">{me.display_name}</div>
          <LanguageSwitch />
          <button className="link" onClick={() => logout.mutate()} disabled={logout.isPending}>
            {t('auth.signOut')}
          </button>
        </div>
      </nav>
      <main>
        <RecoveryBanner />
        <Routes>
          <Route path="/" element={<TodayPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/sessions/new" element={<StartSessionPage />} />
          <Route path="/sessions/record/:clientId" element={<RecordPage />} />
          <Route path="/sessions/:id" element={<SessionPage />} />
          <Route path="/sessions/:id/report" element={<ReportPage />} />
          {NAV_ITEMS.filter((item) => !['today', 'clients', 'sessions'].includes(item.key)).map((item) => (
            <Route key={item.key} path={item.path} element={<PlaceholderPage navKey={item.key} />} />
          ))}
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/clients/new" element={<NewClientPage />} />
          <Route path="/clients/:id" element={<ClientPage />} />
          <Route path="/clients/:id/consent" element={<ConsentPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
