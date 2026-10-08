import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useClients } from '../../api/clients'
import { ApiError } from '../../api/client'
import { errorMessage } from '../../i18n/errors'
import { formatDate } from '../format'
import { ReadinessBadge } from './ConsentBadge'

export function ClientsPage() {
  const { t, i18n } = useTranslation()
  const { data: clients, isPending, error } = useClients()
  const [query, setQuery] = useState('')

  const visible = (clients ?? []).filter((c) =>
    c.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  )

  return (
    <section className="page">
      <header className="page-header">
        <h1>{t('nav.clients')}</h1>
        <Link className="button primary" to="/clients/new">
          {t('clients.add')}
        </Link>
      </header>

      {clients && clients.length > 0 && (
        <label className="search">
          <span className="visually-hidden">{t('clients.search')}</span>
          <input
            type="search"
            placeholder={t('clients.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      )}

      {isPending && <p className="muted">{t('common.loading')}</p>}
      {error && (
        <p className="form-error" role="alert">
          {errorMessage(t, error instanceof ApiError ? error.code : 'unknown')}
        </p>
      )}

      {clients && clients.length === 0 && (
        <div className="empty">
          <p>{t('clients.empty')}</p>
          <Link className="button primary" to="/clients/new">
            {t('clients.addFirst')}
          </Link>
        </div>
      )}

      {visible.length > 0 && (
        <ul className="client-list">
          {visible.map((client) => (
            <li key={client.id}>
              <Link to={`/clients/${client.id}`} className="client-row">
                <span className="client-name">{client.name}</span>
                <ReadinessBadge client={client} />
                <span className="muted small">
                  {client.last_session_at
                    ? t('clients.lastSession', { date: formatDate(client.last_session_at, i18n.language) })
                    : t('clients.noSessions')}
                </span>
                <span className="muted small">{client.preferred_language.toUpperCase()}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {clients && clients.length > 0 && visible.length === 0 && (
        <p className="muted">{t('clients.noMatch')}</p>
      )}
    </section>
  )
}
