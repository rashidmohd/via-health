import { useEffect, useState } from 'react'
import type { SessionRecorder } from '../../recorder/recorder'

export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function useElapsed(recorder: SessionRecorder | null): number {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!recorder) return
    const timer = setInterval(() => setTick((tick) => tick + 1), 500)
    return () => clearInterval(timer)
  }, [recorder])
  return recorder ? recorder.elapsedMs() : 0
}
