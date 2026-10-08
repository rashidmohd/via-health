import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { SessionList } from './SessionList'

export function SessionsPage() {
  const { t } = useTranslation()
  return (
    <section className="page">
      <header className="page-header">
        <h1>{t('nav.sessions')}</h1>
        <Link className="button primary" to="/sessions/new">
          {t('sessions.start')}
        </Link>
      </header>
      <div className="card">
        <SessionList showClient />
      </div>
    </section>
  )
}
