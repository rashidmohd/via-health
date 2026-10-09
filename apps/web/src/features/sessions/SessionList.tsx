import { ChevronRight, HardDrive } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useSessions, type ServerSession } from '../../api/sessions'
import { Initials } from '../../design/Initials'
import scheduleIllustration from '../../design/illustrations/schedule.svg'
import { ListSkeleton } from '../../design/ListSkeleton'
import { db } from '../../recorder/db'
import { useLocal } from '../../recorder/useLocal'
import { formatDate, formatTime } from '../format'
import { matchesFilter, sessionStatus, type SessionFilter } from './status'

function minutes(ms: number | null | undefined): number {
  return ms ? Math.max(1, Math.round(ms / 60_000)) : 0
}

/** Sessions still on this device (not fully uploaded) and sessions on the server. */
export function SessionList({
  clientId,
  showClient,
  filter = 'all',
  query = '',
}: {
  clientId?: string
  showClient: boolean
  filter?: SessionFilter
  query?: string
}) {
  const { t, i18n } = useTranslation()
  const { data: server, isPending } = useSessions(clientId)
  const local = useLocal(
    () =>
      db.sessions
        .filter((s) => s.status !== 'synced' && (!clientId || s.clientId === clientId))
        .toArray(),
    clientId ?? '',
  )
  const needle = query.trim().toLocaleLowerCase()
  const localIds = new Set((local ?? []).map((s) => s.id))
  const serverOnly = (server ?? []).filter(
    (s) => !localIds.has(s.id) && matchesFilter(s, filter) && s.client_name.toLocaleLowerCase().includes(needle),
  )
  // Sessions on this device count as in progress: they still need to upload.
  const localShown = (filter === 'toReview' ? [] : (local ?? [])).filter((s) =>
    s.clientName.toLocaleLowerCase().includes(needle),
  )

  if (isPending && !local?.length) return <ListSkeleton rows={4} />
  if (!localShown.length && !serverOnly.length) {
    // Nothing recorded yet (all sessions, or this client's), no filter or search narrowing it.
    if (filter === 'all' && !needle && !server?.length && !local?.length) {
      return (
        <div className="table-empty muted table-empty-first">
          <img className="empty-illustration" src={scheduleIllustration} alt="" aria-hidden="true" />
          <p>{t('sessions.none')}</p>
        </div>
      )
    }
    return <p className="table-empty muted">{t(filter === 'all' && !needle ? 'sessions.none' : 'sessions.noMatch')}</p>
  }

  const lang = i18n.language
  return (
    <table className={`table sessions-table${showClient ? '' : ' no-client'}`}>
      <thead>
        <tr>
          <th scope="col">{t('sessions.columns.date')}</th>
          {showClient && <th scope="col">{t('sessions.columns.client')}</th>}
          <th scope="col">{t('sessions.columns.length')}</th>
          <th scope="col">{t('sessions.columns.status')}</th>
          <th scope="col">
            <span className="visually-hidden">{t('clients.columns.actions')}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {localShown.map((s) => (
          <tr key={s.id} className="local">
            <td>
              <span className="cell-date">
                <strong>{formatDate(s.startedAt, lang)}</strong>
                <span className="muted small">{formatTime(s.startedAt, lang)}</span>
              </span>
            </td>
            {showClient && (
              <td>
                <span className="cell-person">
                  <Initials name={s.clientName} />
                  <span className="client-name">{s.clientName}</span>
                </span>
              </td>
            )}
            <td className="muted">–</td>
            <td>
              <span className={`badge ${s.status === 'failed' ? 'attention' : 'info'}`}>
                {s.status === 'recording'
                  ? t('sessions.local.recording')
                  : s.status === 'failed'
                    ? t(`errors.${s.error ?? 'unknown'}`)
                    : t('sessions.local.uploading')}
              </span>
            </td>
            <td className="cell-actions">
              <HardDrive className="icon row-chevron" aria-label={t('sessions.onDevice')} />
            </td>
          </tr>
        ))}
        {serverOnly.map((s) => {
          const status = sessionStatus(t, s)
          const title = showClient ? s.client_name : formatDate(s.started_at, lang)
          return (
            <tr key={s.id}>
              <td>
                <span className="cell-date">
                  {showClient ? (
                    <strong>{formatDate(s.started_at, lang)}</strong>
                  ) : (
                    <Link to={`/sessions/${s.id}`} className="client-name stretched">
                      {title}
                    </Link>
                  )}
                  <span className="muted small">{formatTime(s.started_at, lang)}</span>
                </span>
              </td>
              {showClient && (
                <td>
                  <span className="cell-person">
                    <Initials name={s.client_name} />
                    <span className="cell-stack">
                      <Link to={`/sessions/${s.id}`} className="client-name stretched">
                        {title}
                      </Link>
                      <Topics session={s} />
                    </span>
                  </span>
                </td>
              )}
              <td className="muted">{s.duration_ms ? t('sessions.minutes', { count: minutes(s.duration_ms) }) : '–'}</td>
              <td>
                <span className={`badge ${status.tone}`}>{status.label}</span>
                {!showClient && <Topics session={s} />}
              </td>
              <td className="cell-actions">
                <ChevronRight className="icon row-chevron" aria-hidden="true" />
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Topics({ session: s }: { session: ServerSession }) {
  const { t } = useTranslation()
  if (!s.report_topics?.length) return null
  return (
    <p className="session-topics small" title={s.report_topics.join(' · ')}>
      {s.report_status === 'draft' && <span className="muted">{t('sessions.topicsDraft')} </span>}
      {s.report_topics.join(' · ')}
    </p>
  )
}
