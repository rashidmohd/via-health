import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Language } from '../../api/auth'
import type { Identity } from '../../api/clients'

export interface ClientFormValues {
  identity: Identity
  preferred_language: Language
}

export function ClientForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
  children,
}: {
  initial?: ClientFormValues
  submitLabel: string
  busy: boolean
  onSubmit: (values: ClientFormValues) => void
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial?.identity.name ?? '')
  const [dob, setDob] = useState(initial?.identity.date_of_birth ?? '')
  const [email, setEmail] = useState(initial?.identity.email ?? '')
  const [phone, setPhone] = useState(initial?.identity.phone ?? '')
  const [language, setLanguage] = useState<Language>(initial?.preferred_language ?? 'de')

  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit({
      identity: {
        name: name.trim(),
        date_of_birth: dob || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
      },
      preferred_language: language,
    })
  }

  return (
    <form className="stack" onSubmit={submit}>
      <label>
        {t('clients.fields.name')}
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required />
      </label>
      <label>
        {t('clients.fields.dateOfBirth')} <span className="muted small">{t('common.optional')}</span>
        <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
      </label>
      <label>
        {t('clients.fields.email')} <span className="muted small">{t('common.optional')}</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
      </label>
      <label>
        {t('clients.fields.phone')} <span className="muted small">{t('common.optional')}</span>
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={50} />
      </label>
      <label>
        {t('clients.fields.language')}
        <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
          <option value="de">Deutsch</option>
          <option value="en">English</option>
        </select>
      </label>
      <div className="actions">
        <button className="primary" type="submit" disabled={busy || !name.trim()}>
          {submitLabel}
        </button>
        {children}
      </div>
    </form>
  )
}
