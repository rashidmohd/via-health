import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocalSyncState } from '../../recorder/useLocal'

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

/** Upload state of locally saved audio. Text always; colour only supports it. */
export function SyncBadge() {
  const { t } = useTranslation()
  const state = useLocalSyncState()
  const online = useOnline()
  if (!state) return null

  if (state.failedSessions > 0) {
    return <span className="sync-badge danger">{t('sync.problem', { count: state.failedSessions })}</span>
  }
  if (state.pendingChunks > 0 || state.pendingSessions > 0) {
    return online ? (
      <span className="sync-badge info">{t('sync.uploading')}</span>
    ) : (
      <span className="sync-badge warning">{t('sync.offline')}</span>
    )
  }
  return <span className="sync-badge muted">{t('sync.allSynced')}</span>
}
