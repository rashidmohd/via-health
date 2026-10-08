import { useEffect, useState } from 'react'
import { useActiveRecorder } from '../recorder/active'
import { useLocalSyncState } from '../recorder/useLocal'
import { lastAvatarEvent, onAvatarEvent } from './events'
import { EVENT_MS, moodFor, WELCOME_MS, type AvatarState } from './mood'

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

/** Mood from app state only. `processing` comes from the screen (e.g. session transcribing). */
export function useAvatarMood({ processing = false }: { processing?: boolean } = {}): AvatarState {
  const recording = useActiveRecorder() !== null
  const online = useOnline()
  const sync = useLocalSyncState()
  const [shownAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const rerender = () => setNow(Date.now())
    const unsubscribe = onAvatarEvent(() => {
      rerender()
      setTimeout(rerender, EVENT_MS + 50) // fall back to the resting mood afterwards
    })
    const welcome = setTimeout(rerender, WELCOME_MS + 50)
    return () => {
      unsubscribe()
      clearTimeout(welcome)
    }
  }, [])

  const event = lastAvatarEvent()
  return moodFor({
    recording,
    online,
    problem: (sync?.failedSessions ?? 0) > 0,
    processing,
    sinceShownMs: now - shownAt,
    recent: event ? { event: event.event, ageMs: now - event.at } : null,
  })
}
