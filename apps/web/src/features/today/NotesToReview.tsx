import { CircleCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { ServerSession } from '../../api/sessions'
import { Initials } from '../../design/Initials'
import { ListSkeleton } from '../../design/ListSkeleton'
import { formatDate } from '../format'

const DAY_MS = 24 * 60 * 60 * 1000

/** Drafts waiting for the therapist. Documentation is due the same or the next day. */
export function NotesToReview({ drafts, now }: { drafts: ServerSession[] | undefined; now: number }) {
  const { t, i18n } = useTranslation()
  return (
    <div className="card notes-to-review" data-testid="notes-to-review">
      <div className="card-header">
        <h2>{drafts?.length ? t('today.notesToReview', { count: drafts.length }) : t('today.notesTitle')}</h2>
      </div>
      {drafts === undefined ? (
        <ListSkeleton />
      ) : drafts.length === 0 ? (
        <div className="card-empty">
          <CircleCheck className="icon" aria-hidden="true" />
          <p>{t('today.noNotes')}</p>
        </div>
      ) : (
        <ul className="item-list">
          {drafts.map((s) => {
            const overdue = now - new Date(s.started_at).getTime() > DAY_MS
            return (
              <li key={s.id} className="item">
                <Initials name={s.client_name} />
                <div className="item-main">
                  <Link to={`/sessions/${s.id}/report`} className="item-title stretched">
                    {s.client_name}
                  </Link>
                  {overdue ? (
                    <span className="badge attention">
                      {t('today.overdue', { date: formatDate(s.started_at, i18n.language) })}
                    </span>
                  ) : (
                    <span className="muted small">{formatDate(s.started_at, i18n.language)}</span>
                  )}
                </div>
                <span className="item-action" aria-hidden="true">
                  {t('today.review')}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

