import { ChevronRight, FileSignature, Mic, Search, UserPlus, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useClients, type ClientSummary } from '../../api/clients'
import { ApiError } from '../../api/client'
import { Initials } from '../../design/Initials'
import { ListSkeleton } from '../../design/ListSkeleton'
import { errorMessage } from '../../i18n/errors'
import { formatDate } from '../format'
import { cacheConsent } from '../sessions/cacheConsent'
import { ReadinessBadge } from './ConsentBadge'

const FILTERS = ['all', 'ready', 'needsConsent'] as const
type Filter = (typeof FILTERS)[number]

function matches(client: ClientSummary, filter: Filter): boolean {
  if (filter === 'ready') return client.status === 'active' && client.ready_to_record
  if (filter === 'needsConsent') return client.status === 'active' && !client.ready_to_record
  return true
}

export function ClientsPage() {
  const { t, i18n } = useTranslation()
  const { data: clients, isPending, error } = useClients()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    if (clients) void cacheConsent(clients)
  }, [clients])

  const needle = query.trim().toLocaleLowerCase()
  const visible = (clients ?? []).filter(
    (c) => matches(c, filter) && c.name.toLocaleLowerCase().includes(needle),
  )

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>{t('nav.clients')}</h1>
          {clients && clients.length > 0 && (
            <p className="muted">{t('clients.count', { count: clients.length })}</p>
          )}
        </div>
        <Link className="button primary" to="/clients/new">
          <UserPlus className="icon" aria-hidden="true" />
          {t('clients.add')}
        </Link>
      </header>

      {error && (
        <p className="form-error" role="alert">
          {errorMessage(t, error instanceof ApiError ? error.code : 'unknown')}
        </p>
      )}

      {clients && clients.length === 0 && (
        <div className="empty">
          <span className="empty-icon">
            <Users className="icon" aria-hidden="true" />
          </span>
          <p>{t('clients.empty')}</p>
          <Link className="button primary" to="/clients/new">
            {t('clients.addFirst')}
          </Link>
        </div>
      )}

      {(isPending || (clients && clients.length > 0)) && (
        <div className="table-card">
          <div className="table-toolbar">
            <label className="search">
              <Search className="icon" aria-hidden="true" />
              <span className="visually-hidden">{t('clients.search')}</span>
              <input
                type="search"
                placeholder={t('clients.search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="segmented" role="group" aria-label={t('clients.filter.label')}>
              {FILTERS.map((f) => (
                <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {t(`clients.filter.${f}`)}
                  {clients && <span className="segmented-count">{clients.filter((c) => matches(c, f)).length}</span>}
                </button>
              ))}
            </div>
          </div>

          {isPending ? (
            <ListSkeleton rows={4} />
          ) : visible.length === 0 ? (
            <p className="table-empty muted">{t('clients.noMatch')}</p>
          ) : (
            <table className="table clients-table">
              <thead>
                <tr>
                  <th scope="col">{t('clients.fields.name')}</th>
                  <th scope="col">{t('clients.columns.consent')}</th>
                  <th scope="col">{t('clients.columns.lastSession')}</th>
                  <th scope="col">{t('clients.columns.language')}</th>
                  <th scope="col">
                    <span className="visually-hidden">{t('clients.columns.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((client) => (
                  <tr key={client.id}>
                    <td>
                      <span className="cell-person">
                        <Initials name={client.name} />
                        <Link to={`/clients/${client.id}`} className="client-name stretched">
                          {client.name}
                        </Link>
                      </span>
                    </td>
                    <td>
                      <ReadinessBadge client={client} />
                    </td>
                    <td className="muted">
                      {client.last_session_at
                        ? formatDate(client.last_session_at, i18n.language)
                        : t('clients.noSessions')}
                    </td>
                    <td className="muted">{client.preferred_language.toUpperCase()}</td>
                    <td className="cell-actions">
                      <RowAction client={client} />
                      <ChevronRight className="icon row-chevron" aria-hidden="true" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  )
}

/** Record when consent is complete; otherwise go straight to the consent form. */
function RowAction({ client }: { client: ClientSummary }) {
  const { t } = useTranslation()
  if (client.status !== 'active') return null
  return client.ready_to_record ? (
    <Link
      className="icon-button above"
      to={`/sessions/record/${client.id}`}
      aria-label={t('clients.recordWith', { name: client.name })}
      title={t('clients.record')}
    >
      <Mic className="icon" aria-hidden="true" />
    </Link>
  ) : (
    <Link
      className="icon-button above"
      to={`/clients/${client.id}/consent`}
      aria-label={t('clients.consentFor', { name: client.name })}
      title={t('clients.getConsent')}
    >
      <FileSignature className="icon" aria-hidden="true" />
    </Link>
  )
}
