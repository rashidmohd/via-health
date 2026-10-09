import { Maximize2, Square } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { confirmDialog } from '../../design/confirm'
import { stopActiveRecording, useActiveRecording } from '../../recorder/active'
import { formatElapsed, useElapsed } from './elapsed'
import { MicReconnect, MicReconnectedNote } from './MicReconnect'

/** How long the dock explains itself after the user leaves the recording screen. */
const DOCK_NOTE_MS = 6_000

function recordPath(clientId: string): string {
  return `/sessions/record/${clientId}`
}

/** The minimised recording: shown on every screen except the recording's own while a
 *  recording runs, so leaving the recording screen never hides that the mic is on. */
export function RecordingDock() {
  const recording = useActiveRecording()
  const { pathname } = useLocation()
  if (!recording || pathname === recordPath(recording.clientId)) return null
  return <Dock />
}

function Dock() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const recording = useActiveRecording()!
  const elapsed = useElapsed(recording.recorder)
  const [note, setNote] = useState(true)
  const [stopping, setStopping] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setNote(false), DOCK_NOTE_MS)
    return () => clearTimeout(timer)
  }, [])

  async function stop() {
    const confirmed = await confirmDialog({ message: t('record.stopConfirm'), confirmLabel: t('record.stop') })
    if (!confirmed) return
    setStopping(true)
    const sessionId = await stopActiveRecording()
    if (sessionId) navigate(`/sessions/${sessionId}`)
  }

  return (
    <aside className="recording-dock" aria-label={t('record.dock.label')}>
      <div className="recording-dock-main">
        <p className="recording-indicator">
          <span className="dot" aria-hidden="true" />
          {t('record.recording')}
        </p>
        <span className="recording-dock-name">{recording.clientName}</span>
        <span className="recording-dock-time" aria-label={t('record.elapsed')}>
          {formatElapsed(elapsed)}
        </span>
        <div className="recording-dock-actions">
          <Link className="button secondary" to={recordPath(recording.clientId)}>
            <Maximize2 className="icon" aria-hidden="true" />
            {t('record.dock.open')}
          </Link>
          <button className="danger" onClick={() => void stop()} disabled={stopping}>
            <Square className="icon" aria-hidden="true" />
            {t('record.stop')}
          </button>
        </div>
      </div>
      {recording.problem ? (
        <div className="recording-dock-problem" role="alert">
          {t(`record.problem.${recording.problem}`)}
          {recording.problem === 'mic_lost' && <MicReconnect />}
        </div>
      ) : recording.reconnectedAt ? (
        <MicReconnectedNote className="recording-dock-note" />
      ) : (
        <p className="recording-dock-note" role="status">
          {note ? t('record.dock.continues') : ''}
        </p>
      )}
    </aside>
  )
}
