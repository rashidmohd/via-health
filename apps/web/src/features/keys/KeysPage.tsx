import { Download, KeyRound, Lock, ShieldCheck } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMe } from '../../api/auth'
import { ApiError } from '../../api/client'
import { useKeys, useSaveKeys, type Keys } from '../../api/keys'
import { lock, setUnlocked, useUnlocked } from '../../crypto/keyring'
import {
  checkCode,
  createRecoveryKey,
  createTherapistKey,
  PgpError,
  sameCheckCode,
  unlockPrivateKey,
  type KeyPair,
  type UnlockedKey,
} from '../../crypto/pgp'
import securityOn from '../../design/illustrations/security-on.svg'
import { errorMessage } from '../../i18n/errors'

export const MIN_PASSPHRASE = 12

/** Keys (plan 0014 step A): first-time setup, then lock state and key details. */
export function KeysPage() {
  const { t } = useTranslation()
  const { data: me } = useMe()
  const keys = useKeys(me?.id)

  return (
    <section className="page narrow">
      <header className="page-header">
        <h1>{t('nav.keys')}</h1>
      </header>
      {keys.isPending ? (
        <p className="muted">{t('common.loading')}</p>
      ) : keys.isError ? (
        <p className="banner danger" role="alert">
          {errorMessage(t, keys.error instanceof ApiError ? keys.error.code : 'unknown')}
        </p>
      ) : keys.data && me ? (
        <KeyOverview keys={keys.data} />
      ) : (
        me && <KeySetup userId={me.id} />
      )}
    </section>
  )
}

function download(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/pgp-keys' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function codeOf(error: unknown): string {
  if (error instanceof PgpError || error instanceof ApiError) return error.code
  return 'unknown'
}

/* --- setup ------------------------------------------------------------------------------ */

interface Created {
  therapist: KeyPair
  recovery: KeyPair
  unlocked: UnlockedKey
}

function KeySetup({ userId }: { userId: string }) {
  const [created, setCreated] = useState<Created | null>(null)
  return created ? (
    <RecoveryStep userId={userId} created={created} />
  ) : (
    <PassphraseStep onCreated={setCreated} />
  )
}

function PassphraseStep({ onCreated }: { onCreated: (created: Created) => void }) {
  const { t } = useTranslation()
  const [passphrase, setPassphrase] = useState('')
  const [repeat, setRepeat] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const hintId = useId()

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (passphrase.length < MIN_PASSPHRASE) return setProblem(t('keys.setup.tooShort', { n: MIN_PASSPHRASE }))
    if (passphrase !== repeat) return setProblem(t('keys.setup.mismatch'))
    setProblem(null)
    setBusy(true)
    try {
      const [therapist, recovery] = await Promise.all([createTherapistKey(passphrase), createRecoveryKey()])
      const unlocked = await unlockPrivateKey(therapist.privateKey, passphrase)
      onCreated({ therapist, recovery, unlocked })
    } catch (error) {
      setProblem(errorMessage(t, codeOf(error)))
      setBusy(false)
    }
  }

  return (
    <div className="card stack keys-setup">
      <img className="empty-illustration" src={securityOn} alt="" aria-hidden="true" />
      <h2>{t('keys.setup.title')}</h2>
      <p>{t('keys.setup.intro')}</p>
      <form className="stack" onSubmit={(event) => void submit(event)}>
        <label>
          {t('keys.setup.passphrase')}
          <input
            type="password"
            autoComplete="new-password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            aria-describedby={hintId}
            required
          />
        </label>
        <label>
          {t('keys.setup.passphraseRepeat')}
          <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
        </label>
        <p id={hintId} className="muted small">
          {t('keys.setup.passphraseHint', { n: MIN_PASSPHRASE })} {t('keys.setup.noReset')}
        </p>
        {problem && (
          <p className="form-error" role="alert">
            {problem}
          </p>
        )}
        <div className="actions">
          <button className="primary" disabled={busy}>
            <KeyRound className="icon" aria-hidden="true" />
            {t(busy ? 'keys.setup.creating' : 'keys.setup.create')}
          </button>
        </div>
      </form>
    </div>
  )
}

function RecoveryStep({ userId, created }: { userId: string; created: Created }) {
  const { t } = useTranslation()
  const save = useSaveKeys(userId)
  const [downloaded, setDownloaded] = useState(false)
  const [code, setCode] = useState('')
  const [wrong, setWrong] = useState(false)
  const hintId = useId()

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!sameCheckCode(code, created.recovery.fingerprint)) return setWrong(true)
    setWrong(false)
    // Only the public part of the recovery key is sent; its private key stays in the file.
    save.mutate(
      {
        therapist_public_key: created.therapist.publicKey,
        therapist_private_key: created.therapist.privateKey,
        recovery_public_key: created.recovery.publicKey,
        therapist_fingerprint: created.therapist.fingerprint,
        recovery_fingerprint: created.recovery.fingerprint,
      },
      { onSuccess: () => setUnlocked(created.unlocked) },
    )
  }

  return (
    <div className="card stack keys-setup">
      <h2>{t('keys.setup.recoveryTitle')}</h2>
      <p>{t('keys.setup.recoveryIntro')}</p>
      <div className="actions">
        <button
          type="button"
          className={downloaded ? 'secondary' : 'primary'}
          onClick={() => {
            download('sessio-recovery-key.asc', created.recovery.privateKey)
            setDownloaded(true)
          }}
        >
          <Download className="icon" aria-hidden="true" />
          {t(downloaded ? 'keys.setup.downloadAgain' : 'keys.setup.download')}
        </button>
      </div>
      {downloaded && (
        <form className="stack" onSubmit={submit}>
          <p className="muted small">{t('keys.setup.downloaded')}</p>
          <label>
            {t('keys.setup.checkLabel')}
            <input
              className="check-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              maxLength={12}
              aria-describedby={hintId}
              aria-invalid={wrong}
              required
            />
          </label>
          <p id={hintId} className="muted small">
            {t('keys.setup.checkHint')}
          </p>
          {wrong && (
            <p className="form-error" role="alert">
              {t('keys.setup.checkWrong')}
            </p>
          )}
          {save.error && (
            <p className="form-error" role="alert">
              {errorMessage(t, codeOf(save.error))}
            </p>
          )}
          <div className="actions">
            <button className="primary" disabled={save.isPending}>
              <ShieldCheck className="icon" aria-hidden="true" />
              {t('keys.setup.finish')}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

/* --- set up ----------------------------------------------------------------------------- */

function groups(fingerprint: string): string {
  return fingerprint.toUpperCase().match(/.{1,4}/g)?.join(' ') ?? ''
}

function KeyOverview({ keys }: { keys: Keys }) {
  const { t } = useTranslation()
  const unlocked = useUnlocked()

  return (
    <>
      <div className="card stack">
        <div className="card-header">
          <h2>{t('keys.status.title')}</h2>
          <span className={`badge ${unlocked ? 'info' : 'neutral'}`}>
            {t(unlocked ? 'keys.status.unlocked' : 'keys.status.locked')}
          </span>
        </div>
        {unlocked ? (
          <>
            <p className="muted">{t('keys.status.unlockedHint')}</p>
            <div className="actions">
              <button className="secondary" onClick={lock}>
                <Lock className="icon" aria-hidden="true" />
                {t('keys.status.lockNow')}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">{t('keys.status.lockedHint')}</p>
            <UnlockForm keys={keys} />
          </>
        )}
      </div>

      <div className="card stack">
        <h2>{t('keys.details.title')}</h2>
        <dl className="key-details">
          <dt>{t('keys.details.therapist')}</dt>
          <dd className="fingerprint">{groups(keys.therapist_fingerprint)}</dd>
          <dt>{t('keys.details.recovery')}</dt>
          <dd className="fingerprint">
            {groups(keys.recovery_fingerprint)}
            <span className="muted small"> · {t('keys.details.checkCode', { code: checkCode(keys.recovery_fingerprint) })}</span>
          </dd>
        </dl>
        <p className="muted small">{t('keys.details.fingerprintHint')}</p>
        <div className="actions">
          <button className="secondary" onClick={() => download('sessio-public-key.asc', keys.therapist_public_key)}>
            <Download className="icon" aria-hidden="true" />
            {t('keys.details.downloadPublic')}
          </button>
        </div>
        <p className="muted small">{t('keys.details.forgotten')}</p>
      </div>
    </>
  )
}

/** Passphrase → unlocked key in memory. Reused wherever a key is needed (plan 0014 step B). */
export function UnlockForm({ keys, onUnlocked }: { keys: Keys; onUnlocked?: () => void }) {
  const { t } = useTranslation()
  const [passphrase, setPassphrase] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      setUnlocked(await unlockPrivateKey(keys.therapist_private_key, passphrase))
      setPassphrase('')
      onUnlocked?.()
    } catch (error) {
      setProblem(errorMessage(t, codeOf(error)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack" onSubmit={(event) => void submit(event)}>
      <label>
        {t('keys.setup.passphrase')}
        <input
          type="password"
          autoComplete="current-password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          aria-invalid={problem !== null}
          required
        />
      </label>
      {problem && (
        <p className="form-error" role="alert">
          {problem}
        </p>
      )}
      <div className="actions">
        <button className="primary" disabled={busy}>
          <KeyRound className="icon" aria-hidden="true" />
          {t(busy ? 'keys.status.unlocking' : 'keys.status.unlock')}
        </button>
      </div>
    </form>
  )
}
