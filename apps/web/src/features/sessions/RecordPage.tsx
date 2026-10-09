import { AudioLines, Bookmark, ChevronLeft, CircleCheck, Mic, ShieldCheck, Square } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { useClient } from '../../api/clients'
import { useSession } from '../../api/sessions'
import { AppAvatar, UserAvatar } from '../../avatar/AppAvatar'
import { AvatarRing } from '../../avatar/AvatarRing'
import { ringState } from '../../avatar/ring'
import { useAvatarMood } from '../../avatar/useAvatarMood'
import { Initials } from '../../design/Initials'
import { prewarmLivePreview } from '../../live-stt/preview'
import { LIVE_STT_LANGUAGES, type LiveSttLanguage } from '../../live-stt/version'
import { getActiveRecorder, setActiveRecorder, useActiveRecorder } from '../../recorder/active'
import { db } from '../../recorder/db'
import { playCue } from '../../recorder/cues'
import { micTested } from '../../recorder/micDevice'
import { useVoiceState } from '../../recorder/micMonitor'
import { RecorderError, SessionRecorder, type RecorderProblem } from '../../recorder/recorder'
import { useLocal } from '../../recorder/useLocal'
import { useDeviceSetting } from '../settings/deviceSettings'
import { LivePanel } from './LivePanel'
import { MicHealth, MicTest } from './MicHealth'

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
  const [bookmarks, setBookmarks] = useState(0)
  const [tested, setTested] = useState(micTested)
  const onMicPassed = useCallback(() => setTested(true), [])
  const voice = useVoiceState()
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
  const { mood, nod } = useAvatarMood()

  // Load the live transcript engine while the therapist gets ready, so it is running when
  // the recording starts (the preview takes it over).
  const [livePreview] = useDeviceSetting('livePreview')
  const liveLanguage = client?.preferred_language
  useEffect(() => {
    if (!livePreview || active || !liveLanguage) return
    if (!(LIVE_STT_LANGUAGES as readonly string[]).includes(liveLanguage)) return
    return prewarmLivePreview(liveLanguage as LiveSttLanguage)
  }, [livePreview, active, liveLanguage])

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
      playCue('start')
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
    playCue('stop') // after stop, so the sound is not in the recording
    setActiveRecorder(null)
    setStoppedSessionId(recorder.sessionId)
  }

  if (!client && !cached && !isError) return <p className="muted">{t('common.loading')}</p>

  return (
    <section className="page narrow record-page">
      <Link to="/sessions/new" className="back">
        <ChevronLeft className="icon" aria-hidden="true" />
        {t('sessions.start')}
      </Link>
      <header className="page-header">
        <div className="record-header">
          <Initials name={name} />
          <div>
            <h1>{name}</h1>
            {client && (
              <p className="muted small">
                {t('clients.fields.language')}: {client.preferred_language.toUpperCase()}
              </p>
            )}
          </div>
        </div>
        {!recordingHere && <AppAvatar size={56} problem={!ready} done={stoppedSession?.status === 'synced'} />}
      </header>

      {problem && (
        <p className="banner danger" role="alert">
          {t(`record.problem.${problem}`)}
        </p>
      )}

      {active && !recordingHere && <p className="banner warning">{t('record.otherActive')}</p>}

      {recordingHere ? (
        <div className="record-stage is-recording">
          <p className="recording-indicator" role="status">
            <span className="dot" aria-hidden="true" />
            {t('record.recording')}
          </p>
          <AvatarRing state={ringState({ recording: true, voiceActive: voice.active })}>
            <UserAvatar mood={mood} nod={nod} recording size={120} />
          </AvatarRing>
          <p className="timer" aria-label={t('record.elapsed')}>
            {formatElapsed(elapsed)}
          </p>
          <MicHealth />
          <div className="actions record-actions">
            <button
              className="secondary"
              onClick={() => void active?.bookmark().then(() => setBookmarks((n) => n + 1))}
            >
              <Bookmark className="icon" aria-hidden="true" />
              {t('record.bookmark')}
            </button>
            <button className="record-button stop" onClick={() => void stop()}>
              <Square className="icon" aria-hidden="true" />
              {t('record.stop')}
            </button>
          </div>
          <ul className="record-meta">
            <li>
              <ShieldCheck className="icon" aria-hidden="true" />
              {t('record.savedLocally')}
            </li>
            {transcribedMinutes > 0 && (
              <li>
                <AudioLines className="icon" aria-hidden="true" />
                {t('record.transcribedSoFar', { count: transcribedMinutes })}
              </li>
            )}
            {bookmarks > 0 && (
              <li role="status">
                <Bookmark className="icon" aria-hidden="true" />
                {t('record.bookmarks', { count: bookmarks })}
              </li>
            )}
          </ul>
          {active && (
            <LivePanel sessionId={active.sessionId} recorder={active} language={client?.preferred_language ?? 'de'} />
          )}
        </div>
      ) : null}

      {recordingHere ? null : stoppedSession ? (
        <div className="record-stage">
          <span className="stage-icon">
            <CircleCheck className="icon" aria-hidden="true" />
          </span>
          <p className="done">{t('record.saved')}</p>
          <p className="muted">
            {stoppedSession.status === 'synced'
              ? t('record.uploaded')
              : stoppedSession.status === 'failed'
                ? t(`errors.${stoppedSession.error ?? 'unknown'}`)
                : t('record.uploading', { count: pendingChunks ?? 0 })}
          </p>
          <div className="actions record-actions">
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
        <div className="record-stage">
          {!ready && (
            <p className="banner warning">
              {t('consent.missingShort')} · <Link to={`/clients/${clientId}/consent`}>{t('consent.record')}</Link>
            </p>
          )}
          {!tested ? (
            <MicTest onPassed={onMicPassed} />
          ) : (
            <button
              className="record-orb"
              onClick={() => void start()}
              disabled={!ready || starting || active !== null}
            >
              <span className="orb" aria-hidden="true">
                <Mic className="icon" />
              </span>
              <span className="orb-label">{t('record.start')}</span>
            </button>
          )}
          <p className="muted small record-hint">
            <ShieldCheck className="icon" aria-hidden="true" />
            {t('record.hint')}
          </p>
        </div>
      )}
    </section>
  )
}
