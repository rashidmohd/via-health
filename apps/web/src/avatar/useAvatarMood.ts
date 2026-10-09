import { useEffect, useState } from 'react'
import { useActiveRecorder } from '../recorder/active'
import { useLocalSyncState } from '../recorder/useLocal'
import { lastAvatarEvent, onAvatarEvent } from './events'
import { useAvatarSettings } from './settings'
import { EVENT_MS, moodFor, NOD_MS, WELCOME_MS, type AvatarState } from './mood'

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}

/** Mood from app state only. `processing` and `problem` come from the screen (e.g. session
 *  transcribing, consent missing). */
export function useAvatarMood({
  processing = false,
  problem = false,
}: { processing?: boolean; problem?: boolean } = {}): AvatarState & { recording: boolean; online: boolean } {
  const recording = useActiveRecorder() !== null
  const online = useOnline()
  const sync = useLocalSyncState()
  const { nodOnCapture } = useAvatarSettings()
  const [shownAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const rerender = () => setNow(Date.now())
    const unsubscribe = onAvatarEvent(() => {
      rerender()
      setTimeout(rerender, NOD_MS + 50) // end the glance, so the next chip can glance again
      setTimeout(rerender, EVENT_MS + 50) // fall back to the resting mood afterwards
    })
    const welcome = setTimeout(rerender, WELCOME_MS + 50)
    return () => {
      unsubscribe()
      clearTimeout(welcome)
    }
  }, [])

  const event = lastAvatarEvent()
  const state = moodFor({
    recording,
    online,
    problem: problem || (sync?.failedSessions ?? 0) > 0,
    processing,
    sinceShownMs: now - shownAt,
    recent: event ? { event: event.event, ageMs: now - event.at } : null,
    nodOnCapture,
  })
  return { ...state, recording, online }
}
