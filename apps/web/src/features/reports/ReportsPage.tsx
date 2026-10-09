import { ChevronRight, Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useApprovedReports, type ApprovedReport } from '../../api/reports'
import { Initials } from '../../design/Initials'
import notedIllustration from '../../design/illustrations/noted.svg'
import { ListSkeleton } from '../../design/ListSkeleton'
import { formatDate, formatTime } from '../format'

/** Approved session notes (plan 0013). Drafts stay on their session until approved. */
export function ReportsPage() {
  const { t } = useTranslation()
  const { data: reports, isPending } = useApprovedReports()
  const [query, setQuery] = useState('')
  const needle = query.trim().toLocaleLowerCase()
  const shown = (reports ?? []).filter((r) => r.client_name.toLocaleLowerCase().includes(needle))

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>{t('nav.reports')}</h1>
          {reports && reports.length > 0 && <p className="muted">{t('reports.count', { count: reports.length })}</p>}
        </div>
      </header>
      <div className="table-card">
        {reports && reports.length > 0 && (
          <div className="table-toolbar">
            <label className="search">
              <Search className="icon" aria-hidden="true" />
              <span className="visually-hidden">{t('reports.search')}</span>
              <input
                type="search"
                placeholder={t('reports.search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
        )}
        {isPending ? (
          <ListSkeleton rows={4} />
        ) : !reports?.length ? (
          <div className="table-empty muted table-empty-first">
            <img className="empty-illustration" src={notedIllustration} alt="" aria-hidden="true" />
            <p>{t('reports.none')}</p>
            <p className="small">{t('reports.noneHint')}</p>
          </div>
        ) : !shown.length ? (
          <p className="table-empty muted">{t('reports.noMatch')}</p>
        ) : (
          <ReportTable reports={shown} />
        )}
      </div>
    </section>
  )
}

function ReportTable({ reports }: { reports: ApprovedReport[] }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  return (
    <table className="table sessions-table reports-table">
      <thead>
        <tr>
          <th scope="col">{t('reports.columns.session')}</th>
          <th scope="col">{t('reports.columns.client')}</th>
          <th scope="col">{t('reports.columns.type')}</th>
          <th scope="col">{t('reports.columns.approved')}</th>
          <th scope="col">
            <span className="visually-hidden">{t('clients.columns.actions')}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {reports.map((r) => (
          <tr key={r.session_id}>
            <td>
              <span className="cell-date">
                <strong>{formatDate(r.started_at, lang)}</strong>
                <span className="muted small">
                  {r.session_no ? t('reports.sessionNo', { no: r.session_no }) : formatTime(r.started_at, lang)}
                </span>
              </span>
            </td>
            <td>
              <span className="cell-person">
                <Initials name={r.client_name} />
                <span className="cell-stack">
                  <Link to={`/sessions/${r.session_id}/report`} className="client-name stretched">
                    {r.client_name}
                  </Link>
                  {r.topics.length > 0 && (
                    <p className="session-topics small" title={r.topics.join(' · ')}>
                      {r.topics.join(' · ')}
                    </p>
                  )}
                </span>
              </span>
            </td>
            <td className="muted">{r.session_type ? t(`report.sessionTypes.${r.session_type}`) : '–'}</td>
            <td>
              <span className="cell-date">
                <span>{formatDate(r.approved_at, lang)}</span>
                {r.addenda > 0 && (
                  <span className="muted small">{t('reports.addenda', { count: r.addenda })}</span>
                )}
              </span>
            </td>
            <td className="cell-actions">
              <ChevronRight className="icon row-chevron" aria-hidden="true" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
