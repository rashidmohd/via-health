import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { ME_KEY, startEmailLogin, verifyEmailCode } from '../../api/auth'
import { errorMessage } from '../../i18n/errors'
import { currentLanguage, setLanguage } from '../../i18n/language'
import { LanguageSwitch } from '../LanguageSwitch'

type Mode = 'login' | 'signup'

function errorCode(error: unknown): string {
  return error instanceof ApiError ? error.code : 'unknown'
}

/** Login and signup share one flow: email (+ name) → 6-digit code by email → logged in. */
export function EmailCodeForm({ mode }: { mode: Mode }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function sendCode() {
    setBusy(true)
    setError(null)
    try {
      await startEmailLogin(email, currentLanguage())
      setStep('code')
      setCode('')
      setNotice(t('auth.codeSent', { email }))
    } catch (e) {
      setError(errorMessage(t, errorCode(e)))
    } finally {
      setBusy(false)
    }
  }

  async function submitEmail(event: FormEvent) {
    event.preventDefault()
    await sendCode()
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const me = await verifyEmailCode({
        email,
        code,
        display_name: mode === 'signup' ? name : undefined,
        language: currentLanguage(),
      })
      setLanguage(me.ui_language)
      queryClient.setQueryData(ME_KEY, me)
    } catch (e) {
      setError(errorMessage(t, errorCode(e)))
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-top">
          <span className="brand">Sessio</span>
          <LanguageSwitch />
        </div>
        <h1>{t(mode === 'signup' ? 'auth.signupTitle' : 'auth.loginTitle')}</h1>

        {step === 'email' ? (
          <form onSubmit={submitEmail}>
            {mode === 'signup' && (
              <label>
                {t('auth.name')}
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  maxLength={100}
                  required
                />
              </label>
            )}
            <label>
              {t('auth.email')}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>
            <button className="primary" type="submit" disabled={busy}>
              {t('auth.sendCode')}
            </button>
          </form>
        ) : (
          <form onSubmit={submitCode}>
            {notice && <p className="muted">{notice}</p>}
            <label>
              {t('auth.code')}
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                required
                autoFocus
              />
            </label>
            <button className="primary" type="submit" disabled={busy || code.length !== 6}>
              {t(mode === 'signup' ? 'auth.createAccount' : 'auth.signIn')}
            </button>
            <div className="auth-links">
              <button type="button" className="link" onClick={() => void sendCode()} disabled={busy}>
                {t('auth.resend')}
              </button>
              <button type="button" className="link" onClick={() => setStep('email')}>
                {t('auth.changeEmail')}
              </button>
            </div>
          </form>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <p className="auth-switch">
          {mode === 'signup' ? (
            <>
              {t('auth.haveAccount')} <Link to="/login">{t('auth.signIn')}</Link>
            </>
          ) : (
            <>
              {t('auth.noAccount')} <Link to="/signup">{t('auth.createAccount')}</Link>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
