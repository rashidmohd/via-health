import { useEffect, useRef, useState } from 'react'
import type { Language } from '../../api/auth'
import type { LocalLine } from '../../live-stt/merge'
import { LivePreview, livePreviewSupported, type PreviewEvent } from '../../live-stt/preview'
import { LIVE_STT_LANGUAGES, type LiveSttLanguage } from '../../live-stt/version'
import type { SessionRecorder } from '../../recorder/recorder'
import { useDeviceSetting } from '../settings/deviceSettings'

export type PreviewStatus = 'idle' | 'loading' | 'live' | 'too_slow' | 'error' | 'unsupported' | 'language' | 'off'

export interface LivePreviewState {
  status: PreviewStatus
  /** Model download progress 0…1 while `loading`. */
  progress: number
  /** Finished device lines. */
  finals: LocalLine[]
  /** The sentence being spoken right now. */
  partial: { text: string; startMs: number } | null
  /** False for languages without an in-browser model (no on/off switch then). */
  supportedLanguage: boolean
  enabled: boolean
  toggle: () => void
}

/**
 * The in-browser live preview of a running recording (plan 0007 part 2). One engine feeds both
 * the caption under the voice bar and the transcript at the bottom of the card (ADR 0014).
 * `recorder` null: nothing runs.
 */
export function useLivePreview(
  recorder: SessionRecorder | null,
  language: Language,
  /** Changes when the microphone was reconnected (ADR 0022): the preview taps the new stream. */
  micGeneration = 0,
): LivePreviewState {
  const [enabled, setEnabled] = useDeviceSetting('livePreview')
  const [status, setStatus] = useState<PreviewStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [finals, setFinals] = useState<LocalLine[]>([])
  const [partial, setPartial] = useState<{ text: string; startMs: number } | null>(null)
  const preview = useRef<LivePreview | null>(null)

  const supportedLanguage = (LIVE_STT_LANGUAGES as readonly string[]).includes(language)
  const [supportedBrowser] = useState(livePreviewSupported)
  const canRun = supportedLanguage && supportedBrowser

  // A new recording starts with an empty preview.
  const [shownFor, setShownFor] = useState(recorder)
  if (shownFor !== recorder) {
    setShownFor(recorder)
    setFinals([])
    setPartial(null)
    setStatus('idle')
  }

  useEffect(() => {
    if (!recorder || !enabled || !canRun) return
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
  }, [recorder, enabled, canRun, language, micGeneration])

  const shownStatus: PreviewStatus = !enabled
    ? 'off'
    : !supportedLanguage
      ? 'language'
      : !supportedBrowser
        ? 'unsupported'
        : status

  return {
    status: shownStatus,
    progress,
    finals,
    partial,
    supportedLanguage,
    enabled,
    toggle: () => {
      const next = !enabled
      setEnabled(next)
      setStatus(next ? 'idle' : 'off')
    },
  }
}
