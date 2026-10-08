import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Language } from '../../api/auth'
import { ApiError } from '../../api/client'
import {
  REQUIRED_KINDS,
  useClient,
  useConsentTexts,
  useGrantConsents,
  type ConsentKind,
} from '../../api/clients'
import { errorMessage } from '../../i18n/errors'
import { SignaturePad } from './SignaturePad'

/** Shown to the client on the therapist's device. Texts in the client's language. */
export function ConsentPage() {
  const { id = '' } = useParams()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: client } = useClient(id)
  const [language, setLanguage] = useState<Language | null>(null)
  const textLanguage = language ?? client?.preferred_language ?? 'de'
  const { data: texts } = useConsentTexts(textLanguage)
  const grant = useGrantConsents(id)

  // Each consent is ticked on its own; nothing is pre-ticked (never bundled).
  const [chosen, setChosen] = useState<Set<ConsentKind>>(new Set())
  const [signedBy, setSignedBy] = useState<'client' | 'guardian'>('client')
  const [signature, setSignature] = useState<string | null>(null)

  if (!client || !texts) return <p className="muted">{t('common.loading')}</p>

  const open = texts.filter((text) => client.consent[text.kind] !== 'granted')

  function toggle(kind: ConsentKind) {
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!signature || chosen.size === 0) return
    grant.mutate(
      { kinds: [...chosen], language: textLanguage, signed_by: signedBy, signature },
      { onSuccess: () => navigate(`/clients/${id}`) },
    )
  }

  return (
    <section className="page narrow">
      <Link to={`/clients/${id}`} className="back">
        ← {client.name}
      </Link>
      <h1>{t('consent.title')}</h1>

      <div className="row">
        <span className="muted">{t('consent.textLanguage')}</span>
        <div className="language-switch" role="group" aria-label={t('consent.textLanguage')}>
          {(['de', 'en'] as const).map((lang) => (
            <button
              key={lang}
              type="button"
              aria-pressed={textLanguage === lang}
              onClick={() => setLanguage(lang)}
            >
              {lang.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {open.length === 0 ? (
        <p>{t('consent.allGiven')}</p>
      ) : (
        <form className="stack" onSubmit={submit}>
          {open.map((text) => (
            <div key={text.id} className="consent-item">
              <h2>
                {t(`consent.kinds.${text.kind}`)}{' '}
                <span className="muted small">
                  {REQUIRED_KINDS.includes(text.kind) ? t('consent.requiredForRecording') : t('common.optional')}
                </span>
              </h2>
              <p className="consent-text" lang={text.language}>
                {text.body}
              </p>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={chosen.has(text.kind)}
                  onChange={() => toggle(text.kind)}
                />
                {t(`consent.agree.${text.kind}`)}
              </label>
            </div>
          ))}

          <fieldset className="signer">
            <legend>{t('consent.signedBy')}</legend>
            <label className="checkbox">
              <input
                type="radio"
                name="signedBy"
                checked={signedBy === 'client'}
                onChange={() => setSignedBy('client')}
              />
              {t('consent.signer.client')}
            </label>
            <label className="checkbox">
              <input
                type="radio"
                name="signedBy"
                checked={signedBy === 'guardian'}
                onChange={() => setSignedBy('guardian')}
              />
              {t('consent.signer.guardian')}
            </label>
          </fieldset>

          <SignaturePad onChange={setSignature} />

          <div className="actions">
            <button
              className="primary"
              type="submit"
              disabled={grant.isPending || chosen.size === 0 || !signature}
            >
              {t('consent.save')}
            </button>
          </div>
          {grant.error && (
            <p className="form-error" role="alert">
              {errorMessage(t, grant.error instanceof ApiError ? grant.error.code : 'unknown')}
            </p>
          )}
        </form>
      )}
    </section>
  )
}
