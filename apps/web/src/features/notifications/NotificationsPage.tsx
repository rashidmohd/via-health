import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { notificationPath, useMarkRead, useNotifications } from '../../api/notifications'

function formatWhen(iso: string, language: string): string {
  return new Date(iso).toLocaleString(language.startsWith('en') ? 'en-GB' : 'de-DE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const ATTENTION = new Set(['transcription_failed', 'report_failed', 'report_no_consent'])

/** Background events: transcript ready, note draft ready, failures (plan 0010). */
export function NotificationsPage() {
  const { t, i18n } = useTranslation()
  const { data } = useNotifications()
  const markRead = useMarkRead()

  if (!data) return <p className="muted">{t('common.loading')}</p>

  return (
    <section className="page narrow">
      <header className="page-header">
        <h1>{t('nav.notifications')}</h1>
        {data.unread > 0 && (
          <button className="link" onClick={() => markRead.mutate({ all: true })} disabled={markRead.isPending}>
            {t('notifications.markAllRead')}
          </button>
        )}
      </header>

      {data.notes_to_review > 0 && (
        <p className="banner warning">
          {t('notifications.notesToReview', { count: data.notes_to_review })}{' '}
          <Link to="/">{t('notifications.showOnToday')}</Link>
        </p>
      )}

      {data.items.length === 0 ? (
        <div className="empty">
          <p>{t('notifications.empty')}</p>
        </div>
      ) : (
        <ul className="notification-list">
          {data.items.map((n) => (
            <li key={n.id} className={n.read ? 'read' : 'unread'}>
              <Link
                to={notificationPath(n)}
                onClick={() => {
                  if (!n.read) markRead.mutate({ ids: [n.id] })
                }}
              >
                <span className={ATTENTION.has(n.kind) ? 'notification-kind attention' : 'notification-kind'}>
                  {t(`notifications.kinds.${n.kind}`)}
                </span>
                <span>{n.client_name}</span>
              </Link>
              <span className="muted small">
                {!n.read && <span className="visually-hidden">{t('notifications.unread')} </span>}
                {formatWhen(n.created_at, i18n.language)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
