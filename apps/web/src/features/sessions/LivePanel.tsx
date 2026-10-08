import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveText } from '../../api/sessions'
import { detectCaptures } from '../../live-stt/detectors'
import { formatClock } from '../format'
import { CaptureChips } from './CaptureChips'

/** Collapsed by default: reading during a session pulls attention away from the client. */
export function LivePanel({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { data: live } = useLiveText(sessionId, open)
  const captures = live ? detectCaptures(live.segments) : []

  return (
    <details className="live-panel" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t('live.title')}</summary>
      <p className="muted small">{t('live.hint')}</p>
      {open && live && live.segments.length === 0 && <p className="muted">{t('live.empty')}</p>}
      {live && live.segments.length > 0 && (
        <>
          <CaptureChips captures={captures} />
          <ol className="transcript live">
            {live.segments.map((segment, index) => (
              <li key={index}>
                <span className="meta">
                  <span className="who">{t('transcript.speaker', { label: segment.speaker ?? '?' })}</span>
                  <span className="time">{formatClock(segment.start_ms)}</span>
                </span>
                <p>{segment.text}</p>
              </li>
            ))}
          </ol>
        </>
      )}
    </details>
  )
}
