import { useTranslation } from 'react-i18next'
import { useSessions } from '../../api/sessions'
import { db } from '../../recorder/db'
import { useLocal } from '../../recorder/useLocal'
import { formatDate } from '../format'

function minutes(ms: number | null | undefined): string {
  return ms ? String(Math.max(1, Math.round(ms / 60_000))) : '–'
}

/** Sessions still on this device (not fully uploaded) and sessions on the server. */
export function SessionList({ clientId, showClient }: { clientId?: string; showClient: boolean }) {
  const { t, i18n } = useTranslation()
  const { data: server } = useSessions(clientId)
  const local = useLocal(
    () =>
      db.sessions
        .filter((s) => s.status !== 'synced' && (!clientId || s.clientId === clientId))
        .toArray(),
    clientId ?? '',
  )
  const localIds = new Set((local ?? []).map((s) => s.id))
  const serverOnly = (server ?? []).filter((s) => !localIds.has(s.id))

  if (!local?.length && !serverOnly.length) {
    return <p className="muted">{t('sessions.none')}</p>
  }

  return (
    <ul className="session-list">
      {(local ?? []).map((s) => (
        <li key={s.id}>
          <div>
            <strong>{showClient ? s.clientName : formatDate(s.startedAt, i18n.language)}</strong>
            {showClient && <span className="muted small"> · {formatDate(s.startedAt, i18n.language)}</span>}
          </div>
          <span className={s.status === 'failed' ? 'status-withdrawn' : 'muted small'}>
            {s.status === 'recording'
              ? t('sessions.local.recording')
              : s.status === 'failed'
                ? t(`errors.${s.error ?? 'unknown'}`)
                : t('sessions.local.uploading')}
          </span>
        </li>
      ))}
      {serverOnly.map((s) => (
        <li key={s.id}>
          <div>
            <strong>{showClient ? s.client_name : formatDate(s.started_at, i18n.language)}</strong>
            {showClient && <span className="muted small"> · {formatDate(s.started_at, i18n.language)}</span>}
            <span className="muted small"> · {t('sessions.minutes', { count: Number(minutes(s.duration_ms)) || 0 })}</span>
          </div>
          <span className="muted small">{t(`sessions.status.${s.status}`)}</span>
        </li>
      ))}
    </ul>
  )
}
