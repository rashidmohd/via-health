import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Language } from '../../api/auth'
import { useLiveText } from '../../api/sessions'
import { emitAvatarEvent } from '../../avatar/events'
import { detectCaptures } from '../../live-stt/detectors'
import { mergeLive, type LocalLine } from '../../live-stt/merge'
import { LivePreview, livePreviewSupported, type PreviewEvent } from '../../live-stt/preview'
import { LIVE_STT_LANGUAGES, type LiveSttLanguage } from '../../live-stt/version'
import type { SessionRecorder } from '../../recorder/recorder'
import { formatClock } from '../format'
import { useDeviceSetting } from '../settings/deviceSettings'
import { CaptureChips } from './CaptureChips'

type PreviewStatus = 'idle' | 'loading' | 'live' | 'too_slow' | 'error' | 'unsupported' | 'language' | 'off'

/**
 * Live transcript inside the recording card (ADR 0014). Runs from the start of the recording.
 * Device text (instant, rough) is replaced by server text (better, speakers) once available.
 */
export function LivePanel({
  sessionId,
  recorder,
  language,
}: {
  sessionId: string
  recorder: SessionRecorder
  language: Language
}) {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useDeviceSetting('livePreview')
  const [status, setStatus] = useState<PreviewStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [finals, setFinals] = useState<LocalLine[]>([])
  const [partial, setPartial] = useState<{ text: string; startMs: number } | null>(null)
  const preview = useRef<LivePreview | null>(null)
  const { data: live } = useLiveText(sessionId, true)
  const list = useRef<HTMLOListElement>(null)

  const supportedLanguage = (LIVE_STT_LANGUAGES as readonly string[]).includes(language)
  const [supportedBrowser] = useState(livePreviewSupported)
  const canRun = supportedLanguage && supportedBrowser

  useEffect(() => {
    if (!enabled || !canRun) return
    let cancelled = false
    const onEvent = (event: PreviewEvent) => {
      if (cancelled) return
      switch (event.type) {
        case 'loading':
          setStatus('loading')
          setProgress(event.total ? event.loaded / event.total : 0)
          break
        case 'ready':
          setStatus('live')
          break
        case 'partial':
          setPartial({ text: event.text, startMs: event.startMs })
          break
        case 'final':
          setFinals((lines) => [...lines, { text: event.text, startMs: event.startMs, endMs: event.endMs }])
          setPartial(null)
          break
        case 'too_slow':
          setStatus('too_slow')
          preview.current?.stop()
          break
        case 'error':
          setStatus('error')
          preview.current?.stop()
          break
      }
    }
    LivePreview.start(recorder.mediaStream, recorder.elapsedMs(), language as LiveSttLanguage, onEvent)
      .then((started) => {
        if (cancelled) started.stop()
        else preview.current = started
      })
      .catch(() => !cancelled && setStatus('error'))
    return () => {
      cancelled = true
      preview.current?.stop()
      preview.current = null
      setPartial(null)
    }
  }, [enabled, canRun, recorder, language])

  function toggle() {
    const next = !enabled
    setEnabled(next)
    setStatus(next ? 'idle' : 'off')
  }

  const shownStatus: PreviewStatus = !enabled
    ? 'off'
    : !supportedLanguage
      ? 'language'
      : !supportedBrowser
        ? 'unsupported'
        : status

  const lines = mergeLive(live?.segments ?? [], live?.covered_ms ?? 0, finals, partial)
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
        {supportedLanguage && (
          <button type="button" className="link small" onClick={toggle}>
            {t(enabled ? 'live.turnOff' : 'live.turnOn')}
          </button>
        )}
      </div>
      <p className="muted small" aria-live="polite">
        {shownStatus === 'loading' && progress > 0
          ? t('live.loading', { percent: Math.round(progress * 100) })
          : t(`live.status.${shownStatus}`)}
      </p>
      {lines.length === 0 ? (
        <p className="muted">{t(shownStatus === 'live' ? 'live.listening' : 'live.empty')}</p>
      ) : (
        <>
          <CaptureChips captures={captures} />
          <ol
            ref={list}
            className="transcript live"
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
