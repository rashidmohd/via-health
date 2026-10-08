import { ChevronLeft, CircleAlert, CircleCheck, FileSignature, Mic, Pencil } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import {
  CONSENT_KINDS,
  useClient,
  useUpdateClient,
  useWithdrawConsent,
  type ConsentRecord,
} from '../../api/clients'
import { Initials } from '../../design/Initials'
import { ListSkeleton } from '../../design/ListSkeleton'
import { errorMessage } from '../../i18n/errors'
import { formatDate } from '../format'
import { SessionList } from '../sessions/SessionList'
import { ClientForm } from './ClientForm'
import { HiddenNamesCard } from './HiddenNamesCard'
import { ReadinessBadge } from './ConsentBadge'

export function ClientPage() {
  const { id = '' } = useParams()
  const { t, i18n } = useTranslation()
  const { data: client, error } = useClient(id)
  const update = useUpdateClient(id)
  const withdraw = useWithdrawConsent()
  const [editing, setEditing] = useState(false)

  if (error) {
    return (
      <section className="page">
        <Link to="/clients" className="back">
          <ChevronLeft className="icon" aria-hidden="true" />
          {t('nav.clients')}
        </Link>
        <p className="form-error" role="alert">
          {errorMessage(t, error instanceof ApiError ? error.code : 'unknown')}
        </p>
      </section>
    )
  }
  if (!client) return <ListSkeleton rows={5} />

  const active = client.status === 'active'
  const mutationError = update.error ?? withdraw.error

  function confirmWithdraw(consent: ConsentRecord) {
    if (window.confirm(t('consent.withdrawConfirm', { kind: t(`consent.kinds.${consent.kind}`) }))) {
      withdraw.mutate(consent.id)
    }
  }

  return (
    <section className="page narrow">
      <Link to="/clients" className="back">
        <ChevronLeft className="icon" aria-hidden="true" />
        {t('nav.clients')}
      </Link>
      <header className="page-header">
        <div className="record-header">
          <Initials name={client.name} />
          <div>
            <h1>{client.name}</h1>
            <ReadinessBadge client={client} />
          </div>
        </div>
        {client.ready_to_record && (
          <Link className="button primary" to={`/sessions/record/${client.id}`}>
            <Mic className="icon" aria-hidden="true" />
            {t('sessions.start')}
          </Link>
        )}
      </header>

      <div className="card">
        <h2>{t('clients.details')}</h2>
        {editing ? (
          <ClientForm
            initial={{ identity: client.identity, preferred_language: client.preferred_language }}
            submitLabel={t('clients.save')}
            busy={update.isPending}
            onSubmit={(values) =>
              update.mutate(values, { onSuccess: () => setEditing(false) })
            }
          >
            <button type="button" className="secondary" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </button>
          </ClientForm>
        ) : (
          <>
            <dl className="details">
              <dt>{t('clients.fields.dateOfBirth')}</dt>
              <dd>{client.identity.date_of_birth ? formatDate(client.identity.date_of_birth, i18n.language) : '—'}</dd>
              <dt>{t('clients.fields.email')}</dt>
              <dd>{client.identity.email || '—'}</dd>
              <dt>{t('clients.fields.phone')}</dt>
              <dd>{client.identity.phone || '—'}</dd>
              <dt>{t('clients.fields.language')}</dt>
              <dd>{client.preferred_language === 'de' ? 'Deutsch' : 'English'}</dd>
            </dl>
            {client.status !== 'restricted' && (
              <div className="actions">
                {active && (
                  <button className="secondary" onClick={() => setEditing(true)}>
                    <Pencil className="icon" aria-hidden="true" />
                    {t('common.edit')}
                  </button>
                )}
                <button
                  className="link"
                  onClick={() => update.mutate({ status: active ? 'archived' : 'active' })}
                  disabled={update.isPending}
                >
                  {t(active ? 'clients.archive' : 'clients.reactivate')}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h2>{t('consent.title')}</h2>
        <ul className="consent-status">
          {CONSENT_KINDS.map((kind) => (
            <li key={kind}>
              <span>{t(`consent.kinds.${kind}`)}</span>
              <span className={`consent-state status-${client.consent[kind]}`}>
                {client.consent[kind] === 'granted' ? (
                  <CircleCheck className="icon" aria-hidden="true" />
                ) : (
                  <CircleAlert className="icon" aria-hidden="true" />
                )}
                {t(`consent.status.${client.consent[kind]}`)}
              </span>
            </li>
          ))}
        </ul>
        {active && CONSENT_KINDS.some((kind) => client.consent[kind] !== 'granted') && (
          <Link className="button primary" to={`/clients/${id}/consent`}>
            <FileSignature className="icon" aria-hidden="true" />
            {t('consent.record')}
          </Link>
        )}

        {client.consents.length > 0 && (
          <>
            <h3>{t('consent.history')}</h3>
            <ul className="consent-history">
              {client.consents.map((consent) => (
                <li key={consent.id}>
                  <div>
                    <strong>{t(`consent.kinds.${consent.kind}`)}</strong>
                    <div className="muted small">
                      {t('consent.historyLine', {
                        date: formatDate(consent.granted_at, i18n.language),
                        version: consent.text_version,
                        language: consent.language.toUpperCase(),
                        signer: t(`consent.signer.${consent.signed_by}`),
                      })}
                      {consent.withdrawn_at &&
                        ` · ${t('consent.withdrawnOn', { date: formatDate(consent.withdrawn_at, i18n.language) })}`}
                    </div>
                  </div>
                  {!consent.withdrawn_at && (
                    <button
                      className="link danger"
                      onClick={() => confirmWithdraw(consent)}
                      disabled={withdraw.isPending}
                    >
                      {t('consent.withdraw')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <HiddenNamesCard clientId={client.id} />

      <div className="table-card">
        <div className="table-card-header">
          <h2>{t('nav.sessions')}</h2>
        </div>
        <SessionList clientId={client.id} showClient={false} />
      </div>

      {mutationError && (
        <p className="form-error" role="alert">
          {errorMessage(t, mutationError instanceof ApiError ? mutationError.code : 'unknown')}
        </p>
      )}
    </section>
  )
}
