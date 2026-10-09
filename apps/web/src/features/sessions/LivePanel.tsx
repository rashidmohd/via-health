import type { TFunction } from 'i18next'
import { Mic } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveText } from '../../api/sessions'
import { emitAvatarEvent } from '../../avatar/events'
import { detectCaptures } from '../../live-stt/detectors'
import { mergeLive } from '../../live-stt/merge'
import { formatClock } from '../format'
import { CaptureChips } from './CaptureChips'
import type { LivePreviewState } from './useLivePreview'

function statusText(t: TFunction, live: LivePreviewState): string {
  return live.status === 'loading' && live.progress > 0
    ? t('live.loading', { percent: Math.round(live.progress * 100) })
    : t(`live.status.${live.status}`)
}

/**
 * Transcript in the recording card (ADR 0014): server text with speakers, then device lines the
 * server has not covered yet, then the sentence in progress.
 */
export function LivePanel({ sessionId, live }: { sessionId: string; live: LivePreviewState }) {
  const { t } = useTranslation()
  const { data: server } = useLiveText(sessionId, true)
  const list = useRef<HTMLOListElement>(null)

  const lines = mergeLive(server?.segments ?? [], server?.covered_ms ?? 0, live.finals, live.partial)
  // Chips only from finished lines: the sentence in progress still changes.
  const captures = detectCaptures(
    lines.filter((l) => l.source !== 'partial').map((l) => ({ text: l.text, start_ms: l.startMs })),
  )

  // A new chip from a finished line: the avatar may glance (only if the therapist enabled it).
  // The event carries nothing from the session.
  const captureKeys = captures.map((capture) => capture.key).join('|')
  const seenCaptures = useRef(new Set<string>())
  useEffect(() => {
    const keys = captureKeys ? captureKeys.split('|') : []
    const fresh = keys.filter((key) => !seenCaptures.current.has(key))
    fresh.forEach((key) => seenCaptures.current.add(key))
    if (fresh.length > 0) emitAvatarEvent('capture.noted')
  }, [captureKeys])

  // Follow the newest words, unless the therapist scrolled up to read.
  const lastText = lines.length > 0 ? lines[lines.length - 1].text : ''
  const atBottom = useRef(true)
  useEffect(() => {
    const el = list.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [lines.length, lastText])

  return (
    <section className="live-transcript" aria-labelledby="live-title">
      <div className="row spread">
        <h2 id="live-title">{t('live.title')}</h2>
        {live.supportedLanguage && (
          <button type="button" className="link small" onClick={live.toggle}>
            {t(live.enabled ? 'live.turnOff' : 'live.turnOn')}
          </button>
        )}
      </div>
      <p className="muted small" aria-live="polite">
        {statusText(t, live)}
      </p>
      {lines.length === 0 ? (
        <p className="muted">{t(live.status === 'live' ? 'live.listening' : 'live.empty')}</p>
      ) : (
        <>
          <CaptureChips captures={captures} />
          <ol
            ref={list}
            className="transcript chat live"
            aria-live="polite"
            onScroll={(e) => {
              const el = e.currentTarget
              atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
            }}
          >
            {lines.map((line, index) => (
              // The sentence in progress changes several times a second: not announced, only shown.
              <li
                key={`${line.source}-${line.startMs}-${index}`}
                className={`source-${line.source}`}
                aria-hidden={line.source === 'partial' || undefined}
              >
                {/* Static marker of where the line came from; never shows who is speaking now. */}
                {line.speaker !== null ? (
                  <span className="speaker-tag" aria-hidden="true">
                    {line.speaker}
                  </span>
                ) : (
                  <span className="speaker-tag device" aria-hidden="true">
                    <Mic className="icon" />
                  </span>
                )}
                <div className="line">
                  <span className="meta">
                    <span className="who">
                      {line.speaker !== null
                        ? t('transcript.speaker', { label: line.speaker })
                        : t('live.thisDevice')}
                    </span>
                    <span className="time">{formatClock(line.startMs)}</span>
                  </span>
                  <p>{line.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
      <p className="muted small">{t('live.hint')}</p>
    </section>
  )
}
