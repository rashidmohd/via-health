import { AudioLines, ChevronLeft } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { useRetrySession, useSession, useTranscript } from '../../api/sessions'
import { AppAvatar } from '../../avatar/AppAvatar'
import { emitAvatarEvent } from '../../avatar/events'
import { Initials } from '../../design/Initials'
import { ListSkeleton } from '../../design/ListSkeleton'
import { errorMessage } from '../../i18n/errors'
import { formatDate } from '../format'
import { ReportCard } from '../reports/ReportCard'
import { CaptureReview } from './CaptureReview'
import { TranscriptView } from './TranscriptView'

export function SessionPage() {
  const { id = '' } = useParams()
  const { t, i18n } = useTranslation()
  const { data: session, error } = useSession(id)
  const hasTranscript = session?.status === 'transcribed'
  const { data: transcript } = useTranscript(id, hasTranscript)
  const retry = useRetrySession(id)
  const processing = session?.status === 'uploaded' || session?.status === 'processing'

  // A transcript that finishes while the page is open is an app event for the avatar.
  const previousStatus = useRef(session?.status)
  useEffect(() => {
    const before = previousStatus.current
    previousStatus.current = session?.status
    if (before && before !== 'transcribed' && session?.status === 'transcribed') {
      emitAvatarEvent('transcript.ready')
    }
  }, [session?.status])

  if (error) {
    return (
      <section className="page">
        <Link to="/sessions" className="back">
          <ChevronLeft className="icon" aria-hidden="true" />
          {t('nav.sessions')}
        </Link>
        <p className="form-error" role="alert">
          {errorMessage(t, error instanceof ApiError ? error.code : 'unknown')}
        </p>
      </section>
    )
  }
  if (!session) return <ListSkeleton rows={5} />

  const minutes = session.duration_ms ? Math.max(1, Math.round(session.duration_ms / 60_000)) : null

  return (
    <section className="page narrow">
      <Link to={`/clients/${session.client_id}`} className="back">
        <ChevronLeft className="icon" aria-hidden="true" />
        {session.client_name}
      </Link>
      <header className="page-header">
        <div className="record-header">
          <Initials name={session.client_name} />
          <div>
            <h1>{t('session.title', { date: formatDate(session.started_at, i18n.language) })}</h1>
            <p className="muted small">
              {session.client_name}
              {minutes && ` · ${t('sessions.minutes', { count: minutes })}`}
            </p>
          </div>
        </div>
        <AppAvatar size={56} processing={processing} problem={session.status === 'failed'} done={session.report_status === 'approved'} />
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
          <span className="stage-icon">
            <AudioLines className="icon" aria-hidden="true" />
          </span>
          <div className="progress-text">
            <strong>{t('session.transcribing')}</strong>
            <p className="muted small">
              {t(session.transcribed_ms > 0 ? 'session.finishingHint' : 'session.transcribingHint')}
            </p>
            <span className="progress-bar" aria-hidden="true" />
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

      {hasTranscript && <ReportCard sessionId={id} />}
      {hasTranscript && transcript && <CaptureReview sessionId={id} transcript={transcript} />}
      {hasTranscript && transcript && <TranscriptView sessionId={id} transcript={transcript} clientName={session.client_name} />}
    </section>
  )
}
