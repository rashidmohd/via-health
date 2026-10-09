import { Mic } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { reconnectMicrophone, useActiveRecording } from '../../recorder/active'

/** How long "Microphone reconnected" stays visible. */
const RECONNECTED_NOTE_MS = 10_000

/** Under the "microphone lost" alert (ADR 0022): reconnect without stopping the recording.
 *  The recorder also reconnects by itself when a microphone appears. */
export function MicReconnect() {
  const { t } = useTranslation()
  const [state, setState] = useState<'idle' | 'trying' | 'failed'>('idle')

  async function reconnect() {
    setState('trying')
    setState((await reconnectMicrophone()) ? 'idle' : 'failed')
  }

  return (
    <span className="mic-reconnect">
      <button className="secondary" onClick={() => void reconnect()} disabled={state === 'trying'}>
        <Mic className="icon" aria-hidden="true" />
        {t(state === 'trying' ? 'record.reconnecting' : 'record.reconnect')}
      </button>
      {state === 'failed' && <span className="small">{t('record.reconnectFailed')}</span>}
    </span>
  )
}

/** Short note after the microphone came back. */
export function MicReconnectedNote({ className = 'banner info-banner' }: { className?: string }) {
  const { t } = useTranslation()
  const reconnectedAt = useActiveRecording()?.reconnectedAt ?? null
  // Re-render once when the note expires; visibility itself is derived.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (reconnectedAt === null) return
    const timer = setTimeout(() => setNow(Date.now()), reconnectedAt + RECONNECTED_NOTE_MS - Date.now())
    return () => clearTimeout(timer)
  }, [reconnectedAt])

  if (reconnectedAt === null || now >= reconnectedAt + RECONNECTED_NOTE_MS) return null
  return (
    <p className={className} role="status">
      {t('record.reconnected')}
    </p>
  )
}
