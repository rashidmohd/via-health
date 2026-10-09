import { AudioLines, Bell, CircleAlert, FileText, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { notificationPath, useMarkRead, useNotifications } from '../../api/notifications'
import emptyMailbox from '../../design/illustrations/empty-mailbox.svg'
import { ListSkeleton } from '../../design/ListSkeleton'

function formatWhen(iso: string, language: string): string {
  return new Date(iso).toLocaleString(language.startsWith('en') ? 'en-GB' : 'de-DE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const ATTENTION = new Set(['transcription_failed', 'report_failed', 'report_no_consent'])

const KIND_ICONS: Record<string, LucideIcon> = { transcript_ready: AudioLines, report_ready: FileText }

/** Background events: transcript ready, note draft ready, failures (plan 0010). */
export function NotificationsPage() {
  const { t, i18n } = useTranslation()
  const { data } = useNotifications()
  const markRead = useMarkRead()

  if (!data) return <ListSkeleton rows={4} />

  return (
    <section className="page narrow">
      <header className="page-header">
        <h1>{t('nav.notifications')}</h1>
        {data.unread > 0 && (
          <button className="ghost small-button" onClick={() => markRead.mutate({ all: true })} disabled={markRead.isPending}>
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
          <img className="empty-illustration" src={emptyMailbox} alt="" aria-hidden="true" />
          <p>{t('notifications.empty')}</p>
        </div>
      ) : (
        <ul className="notification-list">
          {data.items.map((n) => {
            const attention = ATTENTION.has(n.kind)
            const Icon = attention ? CircleAlert : (KIND_ICONS[n.kind] ?? Bell)
            return (
            <li key={n.id} className={n.read ? 'read' : 'unread'}>
              <span className={`notification-icon${attention ? ' attention' : ''}`} aria-hidden="true">
                <Icon className="icon" />
              </span>
              <Link
                to={notificationPath(n)}
                onClick={() => {
                  if (!n.read) markRead.mutate({ ids: [n.id] })
                }}
              >
                <span className={attention ? 'notification-kind attention' : 'notification-kind'}>
                  {t(`notifications.kinds.${n.kind}`)}
                </span>
                <span className="muted">{n.client_name}</span>
              </Link>
              <span className="muted small">
                {!n.read && <span className="visually-hidden">{t('notifications.unread')} </span>}
                {formatWhen(n.created_at, i18n.language)}
              </span>
            </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
