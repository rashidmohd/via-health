import { useTranslation } from 'react-i18next'
import { useActiveRecorder } from '../../recorder/active'
import { recoverInterrupted } from '../../recorder/recorder'
import { useLocalSyncState } from '../../recorder/useLocal'

/** Recordings left in `recording` after a crash or reload: their saved audio can still be uploaded. */
export function RecoveryBanner() {
  const { t, i18n } = useTranslation()
  const active = useActiveRecorder()
  const state = useLocalSyncState(active?.sessionId ?? null)
  if (!state || state.interrupted.length === 0) return null

  return (
    <div className="banner warning" role="alert">
      {state.interrupted.map((session) => (
        <div key={session.id} className="banner-row">
          <span>
            {t('recovery.message', {
              name: session.clientName,
              time: new Date(session.startedAt).toLocaleString(i18n.language),
            })}
          </span>
          <button className="secondary" onClick={() => void recoverInterrupted(session.id)}>
            {t('recovery.action')}
          </button>
        </div>
      ))}
    </div>
  )
}
