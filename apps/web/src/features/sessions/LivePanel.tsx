import type { TFunction } from 'i18next'
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

/** Keeps the end of a long sentence so the caption stays two lines high. */
function tail(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(-max)
  const space = cut.indexOf(' ')
  return `…${space > 0 && space < 20 ? cut.slice(space + 1) : cut}`
}

/**
 * What is being said right now, under the voice bar (ADR 0014): the sentence in progress and the
 * one before, nothing older. Rough device text; the transcript below has the better version.
 * Not announced to screen readers (it changes several times a second); the transcript is.
 */
export function LiveCaption({ live }: { live: LivePreviewState }) {
  const { t } = useTranslation()
  const texts = [...live.finals.slice(-2).map((line) => line.text), ...(live.partial?.text ? [live.partial.text] : [])]
  const shown = texts.slice(-2)
  return (
    <div className="live-caption" aria-hidden="true">
      {shown.length > 0 ? (
        shown.map((text, index) => (
          <p key={`${live.finals.length}-${index}`} className={index === shown.length - 1 ? 'now' : 'before'}>
            {tail(text, index === shown.length - 1 ? 140 : 90)}
          </p>
        ))
      ) : (
        <p className="muted small">{live.status === 'live' ? t('live.listening') : statusText(t, live)}</p>
      )}
    </div>
  )
}

/**
 * Transcript at the bottom of the recording card (ADR 0014): server text with speakers, plus
 * finished device lines the server has not covered yet. The sentence in progress is only in
 * the caption.
 */
export function LivePanel({ sessionId, live }: { sessionId: string; live: LivePreviewState }) {
  const { t } = useTranslation()
  const { data: server } = useLiveText(sessionId, true)
  const list = useRef<HTMLOListElement>(null)

  const lines = mergeLive(server?.segments ?? [], server?.covered_ms ?? 0, live.finals, null)
  const captures = detectCaptures(lines.map((l) => ({ text: l.text, start_ms: l.startMs })))

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
        <p className="muted">{t('live.empty')}</p>
      ) : (
        <>
          <CaptureChips captures={captures} />
          <ol
            ref={list}
            className="transcript live"
            aria-live="polite"
            onScroll={(e) => {
              const el = e.currentTarget
              atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
            }}
          >
            {lines.map((line, index) => (
              <li key={`${line.source}-${line.startMs}-${index}`} className={`source-${line.source}`}>
                <span className="meta">
                  <span className="who">
                    {line.speaker !== null
                      ? t('transcript.speaker', { label: line.speaker })
                      : t('live.thisDevice')}
                  </span>
                  <span className="time">{formatClock(line.startMs)}</span>
                </span>
                <p>{line.text}</p>
              </li>
            ))}
          </ol>
        </>
      )}
      <p className="muted small">{t('live.hint')}</p>
    </section>
  )
}
