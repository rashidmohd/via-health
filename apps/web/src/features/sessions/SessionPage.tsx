import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { useRetrySession, useSession, useTranscript } from '../../api/sessions'
import { errorMessage } from '../../i18n/errors'
import { formatDate } from '../format'
import { TranscriptView } from './TranscriptView'

export function SessionPage() {
  const { id = '' } = useParams()
  const { t, i18n } = useTranslation()
  const { data: session, error } = useSession(id)
  const hasTranscript = session?.status === 'transcribed'
  const { data: transcript } = useTranscript(id, hasTranscript)
  const retry = useRetrySession(id)

  if (error) {
    return (
      <section className="page">
        <Link to="/sessions" className="back">
          ← {t('nav.sessions')}
        </Link>
        <p className="form-error" role="alert">
          {errorMessage(t, error instanceof ApiError ? error.code : 'unknown')}
        </p>
      </section>
    )
  }
  if (!session) return <p className="muted">{t('common.loading')}</p>

  const minutes = session.duration_ms ? Math.max(1, Math.round(session.duration_ms / 60_000)) : null

  return (
    <section className="page narrow">
      <Link to={`/clients/${session.client_id}`} className="back">
        ← {session.client_name}
      </Link>
      <header className="page-header">
        <h1>{t('session.title', { date: formatDate(session.started_at, i18n.language) })}</h1>
        {minutes && <span className="muted">{t('sessions.minutes', { count: minutes })}</span>}
      </header>

      {session.status === 'recording' && session.transcribed_ms > 0 && (
        <p className="muted">
          {t('record.transcribedSoFar', { count: Math.floor(session.transcribed_ms / 60_000) })}
        </p>
      )}

      {session.status === 'recording' && (
        <p className="banner warning">
          {t('session.waitingForUpload', {
            done: session.uploaded_chunks,
            total: session.total_chunks ?? '…',
          })}
        </p>
      )}

      {(session.status === 'uploaded' || session.status === 'processing') && (
        <div className="card progress" role="status">
          <span className="spinner" aria-hidden="true" />
          <div>
            <strong>{t('session.transcribing')}</strong>
            <p className="muted small">
              {t(session.transcribed_ms > 0 ? 'session.finishingHint' : 'session.transcribingHint')}
            </p>
          </div>
        </div>
      )}

      {session.status === 'failed' && (
        <div className="banner danger" role="alert">
          <p>{t(`session.failure.${session.failure_reason ?? 'unknown'}`, { defaultValue: t('session.failure.unknown') })}</p>
          {session.audio_state === 'present' && (
            <button className="secondary" onClick={() => retry.mutate()} disabled={retry.isPending}>
              {t('common.retry')}
            </button>
          )}
        </div>
      )}

      {hasTranscript && transcript && <TranscriptView sessionId={id} transcript={transcript} />}
    </section>
  )
}
