import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Language } from '../../api/auth'
import { useLiveText } from '../../api/sessions'
import { detectCaptures } from '../../live-stt/detectors'
import { mergeLive, type LocalLine } from '../../live-stt/merge'
import { LivePreview, livePreviewSupported, type PreviewEvent } from '../../live-stt/preview'
import { LIVE_STT_LANGUAGES } from '../../live-stt/version'
import type { SessionRecorder } from '../../recorder/recorder'
import { formatClock } from '../format'
import { CaptureChips } from './CaptureChips'

type PreviewStatus = 'idle' | 'loading' | 'live' | 'too_slow' | 'error' | 'unsupported' | 'language' | 'off'

const SETTING_KEY = 'sessio.livePreview'

function readSetting(): boolean {
  try {
    return localStorage.getItem(SETTING_KEY) !== 'off'
  } catch {
    return true
  }
}

function writeSetting(on: boolean): void {
  try {
    localStorage.setItem(SETTING_KEY, on ? 'on' : 'off')
  } catch {
    // Storage unavailable: the choice applies to this visit only.
  }
}

/**
 * Collapsed by default: reading during a session pulls attention away from the client.
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
  const [open, setOpen] = useState(false)
  const [enabled, setEnabled] = useState(readSetting)
  const [status, setStatus] = useState<PreviewStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [finals, setFinals] = useState<LocalLine[]>([])
  const [partial, setPartial] = useState<{ text: string; startMs: number } | null>(null)
  const preview = useRef<LivePreview | null>(null)
  const { data: live } = useLiveText(sessionId, open)

  const supportedLanguage = (LIVE_STT_LANGUAGES as readonly string[]).includes(language)
  const [supportedBrowser] = useState(livePreviewSupported)
  const canRun = supportedLanguage && supportedBrowser

  useEffect(() => {
    if (!open || !enabled || !canRun) return
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
    LivePreview.start(recorder.mediaStream, recorder.elapsedMs(), onEvent)
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
  }, [open, enabled, canRun, recorder])

  function toggle() {
    const next = !enabled
    writeSetting(next)
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

  return (
    <details className="live-panel" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t('live.title')}</summary>
      <p className="muted small">{t('live.hint')}</p>
      <div className="row spread">
        <p className="muted small" aria-live="polite">
          {shownStatus === 'loading' && progress > 0
            ? t('live.loading', { percent: Math.round(progress * 100) })
            : t(`live.status.${shownStatus}`)}
        </p>
        {supportedLanguage && (
          <button type="button" className="link small" onClick={toggle}>
            {t(enabled ? 'live.turnOff' : 'live.turnOn')}
          </button>
        )}
      </div>
      {open && lines.length === 0 && <p className="muted">{t('live.empty')}</p>}
      {lines.length > 0 && (
        <>
          <CaptureChips captures={captures} />
          <ol className="transcript live">
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
    </details>
  )
}
