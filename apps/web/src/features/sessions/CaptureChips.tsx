import { useTranslation } from 'react-i18next'
import type { DetectedCapture } from '../../live-stt/detectors'
import { formatClock } from '../format'

/** Quiet, read-only chips during the session. Decisions happen after the session. */
export function CaptureChips({ captures }: { captures: DetectedCapture[] }) {
  const { t } = useTranslation()
  if (captures.length === 0) return null
  return (
    <ul className="chips" aria-label={t('captures.noted')}>
      {captures.map((capture) => (
        <li key={capture.key} className={`chip chip-${capture.kind}`}>
          <span className="chip-kind">{t(`captures.kind.${capture.kind}`)}</span>
          <span className="chip-text">{capture.text || formatClock(capture.atMs)}</span>
        </li>
      ))}
    </ul>
  )
}
