import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { useClient } from '../../api/clients'
import { useSession } from '../../api/sessions'
import { getActiveRecorder, setActiveRecorder, useActiveRecorder } from '../../recorder/active'
import { db } from '../../recorder/db'
import { RecorderError, SessionRecorder, type RecorderProblem } from '../../recorder/recorder'
import { useLocal } from '../../recorder/useLocal'

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

function useElapsed(recorder: SessionRecorder | null): number {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!recorder) return
    const timer = setInterval(() => setTick((tick) => tick + 1), 500)
    return () => clearInterval(timer)
  }, [recorder])
  return recorder ? recorder.elapsedMs() : 0
}

/** Step 2 of a session: record. The recorder keeps running if the user navigates away. */
export function RecordPage() {
  const { clientId = '' } = useParams()
  const { t } = useTranslation()
  const { data: client, isError } = useClient(clientId)
  const cached = useLocal(() => db.consent.get(clientId), clientId)
  const active = useActiveRecorder()
  const elapsed = useElapsed(active)
  const [starting, setStarting] = useState(false)
  const [problem, setProblem] = useState<RecorderProblem | null>(null)
  const [stoppedSessionId, setStoppedSessionId] = useState<string | null>(null)
  const stoppedSession = useLocal(
    () => (stoppedSessionId ? db.sessions.get(stoppedSessionId) : Promise.resolve(undefined)),
    stoppedSessionId ?? '',
  )
  const pendingChunks = useLocal(
    () => (stoppedSessionId ? db.chunks.where('sessionId').equals(stoppedSessionId).count() : Promise.resolve(0)),
    stoppedSessionId ?? '',
  )

  // Server view of the running session: how much is already transcribed (plan 0006).
  const { data: serverSession } = useSession(active?.sessionId ?? '', active !== null)
  const transcribedMinutes = Math.floor((serverSession?.transcribed_ms ?? 0) / 60_000)
  const name = client?.name ?? cached?.name ?? ''
  // Online: the server's answer. Offline: the last known consent status on this device.
  const ready = client ? client.ready_to_record : isError ? (cached?.ready ?? false) : false
  const recordingHere = active !== null && (client?.id ?? clientId) === clientId

  useEffect(() => {
    if (!active) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [active])

  async function start() {
    setStarting(true)
    setProblem(null)
    setStoppedSessionId(null)
    try {
      const recorder = await SessionRecorder.start(
        { id: clientId, name },
        { onProblem: (p) => setProblem(p) },
      )
      setActiveRecorder(recorder)
    } catch (error) {
      setProblem(error instanceof RecorderError ? error.problem : 'unsupported')
    } finally {
      setStarting(false)
    }
  }

  async function stop() {
    const recorder = getActiveRecorder()
    if (!recorder || !window.confirm(t('record.stopConfirm'))) return
    await recorder.stop()
    setActiveRecorder(null)
    setStoppedSessionId(recorder.sessionId)
  }

  if (!client && !cached && !isError) return <p className="muted">{t('common.loading')}</p>

  return (
    <section className="page narrow record-page">
      <Link to="/sessions/new" className="back">
        ← {t('sessions.start')}
      </Link>
      <h1>{name}</h1>

      {problem && (
        <p className="banner danger" role="alert">
          {t(`record.problem.${problem}`)}
        </p>
      )}

      {active && !recordingHere && <p className="banner warning">{t('record.otherActive')}</p>}

      {recordingHere ? (
        <div className="record-panel">
          <p className="recording-indicator" role="status">
            <span className="dot" aria-hidden="true" />
            {t('record.recording')}
          </p>
          <p className="timer" aria-label={t('record.elapsed')}>
            {formatElapsed(elapsed)}
          </p>
          <button className="record-button stop" onClick={() => void stop()}>
            {t('record.stop')}
          </button>
          <p className="muted small">{t('record.savedLocally')}</p>
          {transcribedMinutes > 0 && (
            <p className="muted small">{t('record.transcribedSoFar', { count: transcribedMinutes })}</p>
          )}
        </div>
      ) : stoppedSession ? (
        <div className="record-panel">
          <p className="done">{t('record.saved')}</p>
          <p className="muted">
            {stoppedSession.status === 'synced'
              ? t('record.uploaded')
              : stoppedSession.status === 'failed'
                ? t(`errors.${stoppedSession.error ?? 'unknown'}`)
                : t('record.uploading', { count: pendingChunks ?? 0 })}
          </p>
          <div className="actions">
            <Link className="button primary" to={`/sessions/${stoppedSession.id}`}>
              {t('record.openSession')}
            </Link>
            <Link className="button secondary" to={`/clients/${clientId}`}>
              {t('record.toClient')}
            </Link>
            <Link className="button secondary" to="/sessions">
              {t('nav.sessions')}
            </Link>
          </div>
        </div>
      ) : (
        <div className="record-panel">
          {!ready && (
            <p className="banner warning">
              {t('consent.missingShort')} · <Link to={`/clients/${clientId}/consent`}>{t('consent.record')}</Link>
            </p>
          )}
          <button
            className="record-button"
            onClick={() => void start()}
            disabled={!ready || starting || active !== null}
          >
            <span className="dot" aria-hidden="true" />
            {t('record.start')}
          </button>
          <p className="muted small">{t('record.hint')}</p>
        </div>
      )}
    </section>
  )
}
