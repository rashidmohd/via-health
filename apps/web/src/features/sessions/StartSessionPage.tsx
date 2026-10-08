import { Mic, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useClients } from '../../api/clients'
import { Initials } from '../../design/Initials'
import { ListSkeleton } from '../../design/ListSkeleton'
import { db } from '../../recorder/db'
import { useLocal } from '../../recorder/useLocal'
import { cacheConsent } from './cacheConsent'

interface Choice {
  id: string
  name: string
  ready: boolean
}

/** Step 1 of a session: choose the client. Only clients with consent can be chosen. */
export function StartSessionPage() {
  const { t } = useTranslation()
  const { data: clients, isError } = useClients()
  const cached = useLocal(() => db.consent.toArray())
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (clients) void cacheConsent(clients)
  }, [clients])

  const choices: Choice[] | undefined = clients
    ? clients
        .filter((c) => c.status === 'active')
        .map((c) => ({ id: c.id, name: c.name, ready: c.ready_to_record }))
    : isError && cached
      ? cached.map((c) => ({ id: c.clientId, name: c.name, ready: c.ready }))
      : undefined

  const visible = (choices ?? []).filter((c) =>
    c.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  )

  return (
    <section className="page narrow">
      <header className="page-header">
        <div>
          <h1>{t('sessions.start')}</h1>
          <p className="muted">{t('sessions.chooseClient')}</p>
        </div>
      </header>
      {isError && cached && <p className="banner warning">{t('sessions.offlineList')}</p>}

      {!choices && <ListSkeleton rows={4} />}
      {choices && choices.length === 0 && (
        <div className="empty">
          <p>{t('clients.empty')}</p>
          <Link className="button primary" to="/clients/new">
            {t('clients.addFirst')}
          </Link>
        </div>
      )}
      {choices && choices.length > 0 && (
        <>
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
          <ul className="client-list">
            {visible.map((choice) => (
              <li key={choice.id}>
                {choice.ready ? (
                  <Link to={`/sessions/record/${choice.id}`} className="client-row picker-row">
                    <span className="cell-person">
                      <Initials name={choice.name} />
                      <span className="client-name">{choice.name}</span>
                    </span>
                    <span className="badge info">{t('consent.ready')}</span>
                    <Mic className="icon picker-mic" aria-hidden="true" />
                  </Link>
                ) : (
                  <div className="client-row picker-row disabled" aria-disabled="true">
                    <span className="cell-person">
                      <Initials name={choice.name} />
                      <span className="client-name">{choice.name}</span>
                    </span>
                    <Link to={`/clients/${choice.id}/consent`} className="small">
                      {t('consent.record')}
                    </Link>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
