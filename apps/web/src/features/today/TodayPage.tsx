import { CalendarDays, CloudUpload, FileText, Mic } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useMe } from '../../api/auth'
import { useSessions } from '../../api/sessions'
import { AppAvatar } from '../../avatar/AppAvatar'
import { useLocalSyncState } from '../../recorder/useLocal'
import { formatLongDate, isSameDay } from '../format'
import { NotesToReview } from './NotesToReview'
import { SetupCard } from './SetupCard'
import { TodaySessions } from './TodaySessions'

export function TodayPage() {
  const { t, i18n } = useTranslation()
  const { data: me } = useMe()
  const [now] = useState(() => new Date())
  const hour = now.getHours()
  const greeting = hour < 12 ? 'today.morning' : hour < 18 ? 'today.afternoon' : 'today.evening'

  const { data } = useSessions()
  const sessions = Array.isArray(data) ? data : undefined
  const sync = useLocalSyncState()
  const today = sessions?.filter((s) => isSameDay(s.started_at, now))
  const drafts = sessions?.filter((s) => s.report_status === 'draft')
  // Local reads are instant; if this device's storage can't be read, show a dash rather than a spinner.
  const waiting = sync ? sync.pendingSessions + sync.failedSessions : '–'

  return (
    <section className="page today">
      <div className="today-hero">
        <AppAvatar size={120} />
        <div className="today-hero-text">
          <p className="eyebrow">{formatLongDate(now, i18n.language)}</p>
          <h1>{t(greeting, { name: me?.display_name ?? '' })}</h1>
        </div>
        <Link className="button primary large" to="/sessions/new" data-tour="start">
          <Mic className="icon" aria-hidden="true" />
          {t('sessions.start')}
        </Link>
      </div>

      <SetupCard />

      <div className="stats">
        <Stat icon={CalendarDays} label={t('today.stats.sessionsToday')} value={today?.length} to="/sessions" />
        <Stat icon={FileText} label={t('today.stats.notesToReview')} value={drafts?.length} />
        <Stat icon={CloudUpload} label={t('today.stats.waitingUpload')} value={waiting} />
      </div>

      <div className="today-grid">
        <NotesToReview drafts={drafts} now={now.getTime()} />
        <TodaySessions sessions={today} />
      </div>
    </section>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
  to,
}: {
  icon: typeof Mic
  label: string
  value: number | string | undefined
  to?: string
}) {
  const body = (
    <>
      <span className="stat-label">
        <Icon className="icon" aria-hidden="true" />
        {label}
      </span>
      {value === undefined ? <span className="skeleton stat-skeleton" /> : <span className="stat-value">{value}</span>}
    </>
  )
  return to ? (
    <Link className="stat" to={to}>
      {body}
    </Link>
  ) : (
    <div className="stat">{body}</div>
  )
}
