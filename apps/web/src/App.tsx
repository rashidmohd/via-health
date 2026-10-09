import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useMe } from './api/auth'
import { PlaceholderPage } from './features/PlaceholderPage'
import { EmailCodeForm } from './features/auth/EmailCodeForm'
import { ClientPage } from './features/clients/ClientPage'
import { ClientsPage } from './features/clients/ClientsPage'
import { ConsentPage } from './features/clients/ConsentPage'
import { NewClientPage } from './features/clients/NewClientPage'
import { NameStep } from './features/auth/NameStep'
import { NAV_ITEMS } from './features/nav'
import { NotificationsPage } from './features/notifications/NotificationsPage'
import { ReportPage } from './features/reports/ReportPage'
import { RecordPage } from './features/sessions/RecordPage'
import { SessionPage } from './features/sessions/SessionPage'
import { RecoveryBanner } from './features/sessions/RecoveryBanner'
import { SessionsPage } from './features/sessions/SessionsPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { StartSessionPage } from './features/sessions/StartSessionPage'
import { Sidebar } from './features/shell/Sidebar'
import { ModelPreloadBanner } from './features/shell/ModelPreloadBanner'
import { Topbar } from './features/shell/Topbar'
import { TodayPage } from './features/today/TodayPage'
import { startSync } from './recorder/sync'

export default function App() {
  const { t } = useTranslation()
  const { data: me, isPending, isError, refetch } = useMe()
  const loggedIn = Boolean(me)
  const { pathname } = useLocation()
  // The mobile drawer remembers the route it was opened on, so navigating closes it.
  const [navOpenOn, setNavOpenOn] = useState<string | null>(null)
  const navOpen = navOpenOn === pathname
  const setNavOpen = (open: boolean) => setNavOpenOn(open ? pathname : null)

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
    <div className={navOpen ? 'shell nav-open' : 'shell'}>
      <Sidebar me={me} onClose={() => setNavOpen(false)} />
      <div className="scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />
      <div className="main-panel">
        <Topbar navOpen={navOpen} onMenu={() => setNavOpen(true)} />
        <main>
          <ModelPreloadBanner />
          <RecoveryBanner />
          <Routes>
            <Route path="/" element={<TodayPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/sessions/new" element={<StartSessionPage />} />
            <Route path="/sessions/record/:clientId" element={<RecordPage />} />
            <Route path="/sessions/:id" element={<SessionPage />} />
            <Route path="/sessions/:id/report" element={<ReportPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            {NAV_ITEMS.filter((item) => !['today', 'notifications', 'clients', 'sessions', 'settings'].includes(item.key)).map((item) => (
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
    </div>
  )
}

