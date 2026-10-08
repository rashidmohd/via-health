import { CalendarDays } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { ServerSession } from '../../api/sessions'
import { ListSkeleton } from '../../design/ListSkeleton'
import { formatTime } from '../format'
import { sessionStatus } from '../sessions/status'

function minutes(ms: number | null): number {
  return ms ? Math.max(1, Math.round(ms / 60_000)) : 0
}

/** Sessions recorded today, newest first. */
export function TodaySessions({ sessions }: { sessions: ServerSession[] | undefined }) {
  const { t, i18n } = useTranslation()
  const sorted = sessions && [...sessions].sort((a, b) => b.started_at.localeCompare(a.started_at))
  return (
    <div className="card today-sessions">
      <div className="card-header">
        <h2>{t('today.sessionsTitle')}</h2>
        <Link to="/sessions" className="small">
          {t('today.allSessions')}
        </Link>
      </div>
      {sorted === undefined ? (
        <ListSkeleton />
      ) : sorted.length === 0 ? (
        <div className="card-empty">
          <CalendarDays className="icon" aria-hidden="true" />
          <p>{t('today.noSessionsToday')}</p>
        </div>
      ) : (
        <ul className="item-list">
          {sorted.map((s) => {
            const status = sessionStatus(t, s)
            return (
              <li key={s.id} className="item">
                <span className="item-time">{formatTime(s.started_at, i18n.language)}</span>
                <div className="item-main">
                  <Link to={`/sessions/${s.id}`} className="item-title stretched">
                    {s.client_name}
                  </Link>
                  {s.duration_ms ? (
                    <span className="muted small">{t('sessions.minutes', { count: minutes(s.duration_ms) })}</span>
                  ) : null}
                </div>
                <span className={`badge ${status.tone}`}>{status.label}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
