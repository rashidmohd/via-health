import { liveQuery } from 'dexie'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { db } from './db'

/** Subscribe to a Dexie query; re-renders when the local data changes.
 *  `key` must change whenever the query's inputs change. */
export function useLocal<T>(query: () => Promise<T>, key = ''): T | undefined {
  const [value, setValue] = useState<T>()
  const latest = useRef(query)
  useLayoutEffect(() => {
    latest.current = query
  })
  useEffect(() => {
    const subscription = liveQuery(() => latest.current()).subscribe({
      next: setValue,
      error: () => setValue(undefined),
    })
    return () => subscription.unsubscribe()
  }, [key])
  return value
}

export interface LocalSyncState {
  pendingChunks: number
  pendingSessions: number
  failedSessions: number
  interrupted: { id: string; clientName: string; startedAt: string }[]
}

export function useLocalSyncState(activeSessionId?: string | null): LocalSyncState | undefined {
  return useLocal(async () => {
    const sessions = await db.sessions.toArray()
    return {
      pendingChunks: await db.chunks.count(),
      pendingSessions: sessions.filter((s) => s.status === 'recording' || s.status === 'stopped').length,
      failedSessions: sessions.filter((s) => s.status === 'failed').length,
      interrupted: sessions
        .filter((s) => s.status === 'recording' && s.id !== activeSessionId)
        .map((s) => ({ id: s.id, clientName: s.clientName, startedAt: s.startedAt })),
    }
  }, activeSessionId ?? '')
}
