import { FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useReport } from '../../api/reports'

/** Session page: where the session note stands, with a link to it. */
export function ReportCard({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation()
  const { data: report } = useReport(sessionId)
  if (!report) return null
  const done = report.status === 'signed' || report.status === 'approved'
  const label =
    report.status === 'draft' && report.blocking > 0
      ? t('report.cardBlocking', { count: report.blocking })
      : t(`report.status.${report.status}`)
  return (
    <div className="card row spread report-card">
      <span className="empty-icon">
        <FileText className="icon" aria-hidden="true" />
      </span>
      <div className="report-card-text">
        <h2>{t('report.title')}</h2>
        <p className="muted small" role="status">
          {label}
        </p>
      </div>
      <Link className={`button ${done ? 'secondary' : 'primary'}`} to={`/sessions/${sessionId}/report`}>
        {t(done ? 'report.open' : 'report.review')}
      </Link>
    </div>
  )
}
