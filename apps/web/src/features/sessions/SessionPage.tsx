import { ChevronLeft } from 'lucide-react'
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
import { db } from '../../recorder/db'
import { useLocal } from '../../recorder/useLocal'
import { formatDate } from '../format'
import { ReportCard } from '../reports/ReportCard'
import { CaptureReview } from './CaptureReview'
import { TranscriptView } from './TranscriptView'
import { SignedTranscript } from './SignedTranscript'
import { TranscribingAnimation } from './TranscribingAnimation'

export function SessionPage() {
  const { id = '' } = useParams()
  const { t, i18n } = useTranslation()
  const { data: session, error, refetch } = useSession(id)
  // Not on the server yet: the recording may still be on this device (offline-first upload).
  const local = useLocal(() => db.sessions.get(id), id)
  const localParts = useLocal(() => db.chunks.where('sessionId').equals(id).count(), id) ?? 0
  const notFound = error instanceof ApiError && error.code === 'session_not_found'
  const uploadingHere = notFound && local !== undefined && local.status !== 'failed'
  const hasTranscript = session?.status === 'transcribed'
  const signed = session?.status === 'signed'
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

  useEffect(() => {
    if (!uploadingHere) return
    const timer = setInterval(() => void refetch(), 5_000)
    return () => clearInterval(timer)
  }, [uploadingHere, refetch])

  if (error) {
    return (
      <section className="page">
        <Link to="/sessions" className="back">
          <ChevronLeft className="icon" aria-hidden="true" />
          {t('nav.sessions')}
        </Link>
        {notFound && local ? (
          local.status === 'failed' ? (
            <div className="banner danger" role="alert">
              {t('session.localFailed')}
              <p>{errorMessage(t, local.error ?? 'unknown')}</p>
              <p className="small">{t('session.errorCode', { code: local.error ?? 'unknown' })}</p>
            </div>
          ) : (
            <p className="banner warning" role="status">
              {t('session.localUploading', { count: localParts })}
            </p>
          )
        ) : (
          <p className="form-error" role="alert">
            {errorMessage(t, error instanceof ApiError ? error.code : 'unknown')}
          </p>
        )}
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
        <AppAvatar size={56} processing={processing} problem={session.status === 'failed'} done={session.report_status === 'approved' || session.report_status === 'signed'} />
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
          <TranscribingAnimation />
          <div className="progress-text">
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

      {(hasTranscript || signed) && <ReportCard sessionId={id} />}
      {signed && <SignedTranscript session={session} />}
      {hasTranscript && transcript && <CaptureReview sessionId={id} transcript={transcript} />}
      {hasTranscript && transcript && <TranscriptView sessionId={id} transcript={transcript} clientName={session.client_name} />}
    </section>
  )
}
