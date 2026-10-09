import { Mic, MicOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { audioConstraints, listMics, preferredMic, setMicTested, setPreferredMic } from '../../recorder/micDevice'
import { MicMonitor, micMonitorSupported, onMicLevel, useVoiceState } from '../../recorder/micMonitor'
import { MIC_TEST_MS, silenceTooLong } from './micRules'

/** Mic health (plan 0011): always on while recording, independent of the avatar setting. */

/** RMS → 0…1 on a -60…-10 dBFS scale. */
function meterValue(rms: number): number {
  const db = 20 * Math.log10(Math.max(rms, 1e-6))
  return Math.min(1, Math.max(0, (db + 60) / 50))
}

/** Level bar, updated outside React (~20 times a second). */
function LevelMeter({ subscribe }: { subscribe: (listener: (rms: number) => void) => () => void }) {
  const { t } = useTranslation()
  const fill = useRef<HTMLSpanElement>(null)
  useEffect(
    () =>
      subscribe((rms) => {
        if (fill.current) fill.current.style.transform = `scaleX(${meterValue(rms)})`
      }),
    [subscribe],
  )
  return (
    <span className="level-meter" role="img" aria-label={t('mic.level')}>
      <span className="level-fill" ref={fill} />
    </span>
  )
}

/** Level meter + voice on/off next to the record controls, and the long-silence warning. */
export function MicHealth() {
  const { t } = useTranslation()
  const voice = useVoiceState()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (voice.status !== 'on') return
    const timer = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(timer)
  }, [voice.status])

  if (voice.status === 'off') return null
  if (voice.status === 'unavailable') return <p className="muted small mic-health">{t('mic.unavailable')}</p>

  return (
    <>
      <p className="mic-health small" role="status">
        <LevelMeter subscribe={onMicLevel} />
        <span className={`voice-dot${voice.active ? ' on' : ''}`} aria-hidden="true" />
        {t(voice.active ? 'mic.voice' : 'mic.noVoice')}
      </p>
      {silenceTooLong(voice, now) && (
        <div className="banner warning mic-warning" role="alert">
          <p>{t('mic.silenceWarning')}</p>
          <MicPicker />
          <p className="small">{t('mic.switchHint')}</p>
        </div>
      )}
    </>
  )
}

/** Microphone for the next recording. Switching during a recording needs stop + start. */
export function MicPicker() {
  const { t } = useTranslation()
  const [mics, setMics] = useState<{ id: string; label: string }[]>([])
  const [chosen, setChosen] = useState(() => preferredMic() ?? '')

  useEffect(() => {
    let cancelled = false
    listMics()
      .then((list) => !cancelled && setMics(list))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <label className="mic-picker small">
      {t('mic.nextDevice')}
      <select
        value={chosen}
        onChange={(event) => {
          setChosen(event.target.value)
          setPreferredMic(event.target.value || null)
        }}
      >
        <option value="">{t('mic.default')}</option>
        {mics.map((mic) => (
          <option key={mic.id} value={mic.id}>
            {mic.label}
          </option>
        ))}
      </select>
    </label>
  )
}

type TestStatus = 'idle' | 'testing' | 'failed' | 'denied'

/** Before the first recording on this device: 5 seconds that must pick up a voice. */
export function MicTest({ onPassed }: { onPassed: () => void }) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<TestStatus>('idle')
  const levels = useRef(new Set<(rms: number) => void>())
  const cleanup = useRef<() => void>(() => {})

  useEffect(() => () => cleanup.current(), [])

  useEffect(() => {
    // Can't measure in this browser: don't block recording on a test that can't run.
    if (!micMonitorSupported()) {
      setMicTested()
      onPassed()
    }
  }, [onPassed])

  async function run() {
    cleanup.current()
    setStatus('testing')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints() })
    } catch {
      return setStatus('denied')
    }
    let monitor: MicMonitor | null = null
    let timer = 0
    const finish = () => {
      clearTimeout(timer)
      monitor?.stop()
      stream.getTracks().forEach((track) => track.stop())
    }
    cleanup.current = finish
    try {
      monitor = await MicMonitor.start(stream, {
        calibrate: false,
        onLevel: (rms) => levels.current.forEach((listener) => listener(rms)),
        onVoice: (active) => {
          if (!active) return
          finish()
          setMicTested()
          onPassed()
        },
      })
      timer = window.setTimeout(() => {
        finish()
        setStatus('failed')
      }, MIC_TEST_MS)
    } catch {
      finish()
      setMicTested() // measuring failed, not the microphone: don't block recording
      onPassed()
    }
  }

  const subscribe = (listener: (rms: number) => void) => {
    levels.current.add(listener)
    return () => levels.current.delete(listener)
  }

  return (
    <div className="mic-test">
      <h2>{t('mic.test.title')}</h2>
      <p className="muted">{t('mic.test.hint')}</p>
      {status === 'testing' ? (
        <p className="mic-health" role="status">
          <LevelMeter subscribe={subscribe} />
          {t('mic.test.listening')}
        </p>
      ) : (
        <button className="primary" onClick={() => void run()}>
          <Mic className="icon" aria-hidden="true" />
          {t(status === 'idle' ? 'mic.test.start' : 'common.retry')}
        </button>
      )}
      {(status === 'failed' || status === 'denied') && (
        <div className="banner warning" role="alert">
          <p>
            <MicOff className="icon" aria-hidden="true" />{' '}
            {t(status === 'denied' ? 'record.problem.mic_denied' : 'mic.test.failed')}
          </p>
          <MicPicker />
        </div>
      )}
    </div>
  )
}
