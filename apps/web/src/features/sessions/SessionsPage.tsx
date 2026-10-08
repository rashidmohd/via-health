import { Mic, Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useSessions } from '../../api/sessions'
import { SessionList } from './SessionList'
import { matchesFilter, type SessionFilter } from './status'

const FILTERS: SessionFilter[] = ['all', 'toReview', 'inProgress']

export function SessionsPage() {
  const { t } = useTranslation()
  const { data: sessions } = useSessions()
  const [filter, setFilter] = useState<SessionFilter>('all')
  const [query, setQuery] = useState('')

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>{t('nav.sessions')}</h1>
          {sessions && sessions.length > 0 && (
            <p className="muted">{t('sessions.count', { count: sessions.length })}</p>
          )}
        </div>
        <Link className="button primary" to="/sessions/new">
          <Mic className="icon" aria-hidden="true" />
          {t('sessions.start')}
        </Link>
      </header>
      <div className="table-card">
        <div className="table-toolbar">
          <label className="search">
            <Search className="icon" aria-hidden="true" />
            <span className="visually-hidden">{t('sessions.search')}</span>
            <input
              type="search"
              placeholder={t('sessions.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="segmented" role="group" aria-label={t('clients.filter.label')}>
            {FILTERS.map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {t(`sessions.filter.${f}`)}
                {sessions && (
                  <span className="segmented-count">{sessions.filter((s) => matchesFilter(s, f)).length}</span>
                )}
              </button>
            ))}
          </div>
        </div>
        <SessionList showClient filter={filter} query={query} />
      </div>
    </section>
  )
}
