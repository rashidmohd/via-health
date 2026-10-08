import { ChevronLeft, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { useCreateClient } from '../../api/clients'
import { emitAvatarEvent } from '../../avatar/events'
import { errorMessage } from '../../i18n/errors'
import { ClientForm } from './ClientForm'

export function NewClientPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const create = useCreateClient()

  return (
    <section className="page narrow">
      <Link to="/clients" className="back">
        <ChevronLeft className="icon" aria-hidden="true" />
        {t('nav.clients')}
      </Link>
      <header className="page-header">
        <div>
          <h1>{t('clients.add')}</h1>
          <p className="muted small icon-line">
            <ShieldCheck className="icon" aria-hidden="true" />
            {t('clients.encryptedNote')}
          </p>
        </div>
      </header>
      <div className="card">
        <ClientForm
          submitLabel={t('clients.save')}
          busy={create.isPending}
          onSubmit={(values) =>
            create.mutate(
              { ...values.identity, preferred_language: values.preferred_language },
              {
                onSuccess: (client) => {
                  emitAvatarEvent('client.created')
                  navigate(`/clients/${client.id}/consent`)
                },
              },
            )
          }
        />
      </div>
      {create.error && (
        <p className="form-error" role="alert">
          {errorMessage(t, create.error instanceof ApiError ? create.error.code : 'unknown')}
        </p>
      )}
    </section>
  )
}
