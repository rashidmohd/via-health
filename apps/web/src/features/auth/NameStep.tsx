import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useUpdateMe } from '../../api/auth'
import { errorMessage } from '../../i18n/errors'
import { ApiError } from '../../api/client'
import { Logo } from '../../design/Logo'
import { emitAvatarEvent } from '../../avatar/events'

/** Shown once if the account was created from the login page (no name yet). */
export function NameStep() {
  const { t } = useTranslation()
  const updateMe = useUpdateMe()
  const [name, setName] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    updateMe.mutate({ display_name: name.trim() }, { onSuccess: () => emitAvatarEvent('onboarding.step') })
  }

  const error = updateMe.error
  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <span className="brand">
          <Logo />
        </span>
        <h1>{t('auth.nameTitle')}</h1>
        <label>
          {t('auth.name')}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            maxLength={100}
            required
            autoFocus
          />
        </label>
        <button className="primary" type="submit" disabled={updateMe.isPending || !name.trim()}>
          {t('auth.continue')}
        </button>
        {error && (
          <p className="form-error" role="alert">
            {errorMessage(t, error instanceof ApiError ? error.code : 'unknown')}
          </p>
        )}
      </form>
    </div>
  )
}
