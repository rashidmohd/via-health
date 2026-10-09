import { AudioLines, Bookmark, ChevronLeft, Mic, ShieldCheck, Square } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { useClient } from '../../api/clients'
import { useSession } from '../../api/sessions'
import { AppAvatar, UserAvatar } from '../../avatar/AppAvatar'
import { AvatarRing } from '../../avatar/AvatarRing'
import { ringState } from '../../avatar/ring'
import { useAvatarMood } from '../../avatar/useAvatarMood'
import actionSuccessful from '../../design/illustrations/action-successful.svg'
import filesUploading from '../../design/illustrations/files-uploading.svg'
import uploadWarning from '../../design/illustrations/upload-warning.svg'
import { Initials } from '../../design/Initials'
import { prewarmLivePreview } from '../../live-stt/preview'
import { LIVE_STT_LANGUAGES, type LiveSttLanguage } from '../../live-stt/version'
import { confirmDialog } from '../../design/confirm'
import { reportRecorderProblem, setActiveRecorder, stopActiveRecording, useActiveRecording } from '../../recorder/active'
import { db } from '../../recorder/db'
import { playCue } from '../../recorder/cues'
import { micTested } from '../../recorder/micDevice'
import { useVoiceState } from '../../recorder/micMonitor'
import { RecorderError, SessionRecorder, type RecorderProblem } from '../../recorder/recorder'
import { useLocal } from '../../recorder/useLocal'
import { useDeviceSetting } from '../settings/deviceSettings'
import { formatElapsed, useElapsed } from './elapsed'
import { LivePanel } from './LivePanel'
import { MicHealth, MicTest } from './MicHealth'
import { useLivePreview } from './useLivePreview'

/** Step 2 of a session: record. The recorder keeps running if the user navigates away. */
export function RecordPage() {
  const { clientId = '' } = useParams()
  const { t } = useTranslation()
  const { data: client, isError } = useClient(clientId)
  const cached = useLocal(() => db.consent.get(clientId), clientId)
  const recording = useActiveRecording()
  const active = recording?.recorder ?? null
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
  const recordingHere = recording?.clientId === clientId
  // Start errors are local; problems of a running recording live with the recorder.
  const shownProblem = problem ?? (recordingHere ? recording.problem : null)
  const { mood, nod } = useAvatarMood()
  const live = useLivePreview(recordingHere ? active : null, client?.preferred_language ?? 'de')

  // Load the live transcript engine while the therapist gets ready, so it is running when
  // the recording starts (the preview takes it over).
  const [livePreview] = useDeviceSetting('livePreview')
  const liveLanguage = client?.preferred_language
  useEffect(() => {
    if (!livePreview || active || !liveLanguage) return
    if (!(LIVE_STT_LANGUAGES as readonly string[]).includes(liveLanguage)) return
    return prewarmLivePreview(liveLanguage as LiveSttLanguage)
  }, [livePreview, active, liveLanguage])

  async function start() {
    setStarting(true)
    setProblem(null)
    setStoppedSessionId(null)
    try {
      let started: SessionRecorder | null = null
      const recorder = await SessionRecorder.start(
        { id: clientId, name },
        { onProblem: (p) => started && reportRecorderProblem(started, p) },
      )
      started = recorder
      setActiveRecorder(recorder, { id: clientId, name })
      playCue('start')
    } catch (error) {
      setProblem(error instanceof RecorderError ? error.problem : 'unsupported')
    } finally {
      setStarting(false)
    }
  }

  async function stop() {
    const confirmed = await confirmDialog({ message: t('record.stopConfirm'), confirmLabel: t('record.stop') })
    if (!confirmed) return
    const sessionId = await stopActiveRecording()
    if (sessionId) setStoppedSessionId(sessionId)
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

      {shownProblem && (
        <p className="banner danger" role="alert">
          {t(`record.problem.${shownProblem}`)}
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
          {active && <LivePanel sessionId={active.sessionId} live={live} />}
        </div>
      ) : null}

      {recordingHere ? null : stoppedSession ? (
        <div className="record-stage">
          <img
            className="empty-illustration"
            src={
              stoppedSession.status === 'synced'
                ? actionSuccessful
                : stoppedSession.status === 'failed'
                  ? uploadWarning
                  : filesUploading
            }
            alt=""
            aria-hidden="true"
          />
          <p className="done">{t('record.saved')}</p>
          <p className="muted">
            {stoppedSession.status === 'synced'
              ? t('record.uploaded')
              : stoppedSession.status === 'failed'
                ? t(`errors.${stoppedSession.error ?? 'unknown'}`)
                : t('record.uploading', { count: pendingChunks ?? 0 })}
          </p>
          {stoppedSession.status === 'stopped' && (
            // The text above carries the count; the bar only shows it.
            <span className="upload-progress" aria-hidden="true">
              <span
                style={{
                  transform: `scaleX(${stoppedSession.nextSeq > 0 ? 1 - (pendingChunks ?? 0) / stoppedSession.nextSeq : 0})`,
                }}
              />
            </span>
          )}
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
