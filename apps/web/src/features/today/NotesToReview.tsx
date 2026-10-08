import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useSessions } from '../../api/sessions'
import { formatDate } from '../format'

const DAY_MS = 24 * 60 * 60 * 1000

/** Drafts waiting for the therapist. Documentation is due the same or the next day. */
export function NotesToReview() {
  const { t, i18n } = useTranslation()
  const { data: sessions } = useSessions()
  const [now] = useState(() => Date.now())
  const drafts = Array.isArray(sessions) ? sessions.filter((s) => s.report_status === 'draft') : []
  if (drafts.length === 0) return null
  return (
    <div className="card stack notes-to-review">
      <h2>{t('today.notesToReview', { count: drafts.length })}</h2>
      <ul className="session-list">
        {drafts.map((s) => {
          const overdue = now - new Date(s.started_at).getTime() > DAY_MS
          return (
            <li key={s.id}>
              <Link to={`/sessions/${s.id}/report`}>
                <strong>{s.client_name}</strong>
              </Link>
              <span className={overdue ? 'badge attention' : 'muted small'}>
                {overdue ? t('today.overdue', { date: formatDate(s.started_at, i18n.language) }) : formatDate(s.started_at, i18n.language)}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
