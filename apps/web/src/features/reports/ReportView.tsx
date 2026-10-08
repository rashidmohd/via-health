import { Printer } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../api/client'
import { AI_FIELDS, THERAPIST_FIELDS, useAddAddendum, type Report } from '../../api/reports'
import type { ServerSession } from '../../api/sessions'
import { errorMessage } from '../../i18n/errors'
import { formatDate } from '../format'

/** An approved note: read-only, with dated addenda ("Nachtrag", §630f BGB). */
export function ReportView({ report, session }: { report: Report; session: ServerSession }) {
  const { t, i18n } = useTranslation()
  const addendum = useAddAddendum(session.id)
  const [text, setText] = useState('')
  const { header } = report.content
  const addenda = report.versions.filter((v) => v.kind === 'addendum')

  return (
    <div className="stack narrow-report">
      <p className="banner info-banner" role="status">
        {t('report.approvedOn', { date: formatDate(report.approved_at ?? '', i18n.language) })}
      </p>
      <article className="card stack report-print">
        <header className="doc-header">
          <div>
            <p className="eyebrow">{t('report.title')}</p>
            <h2>{session.client_name}</h2>
          </div>
          <button type="button" className="secondary no-print" onClick={() => window.print()}>
            <Printer className="icon" aria-hidden="true" />
            {t('report.print')}
          </button>
        </header>
        <dl className="details">
          <dt>{t('report.date')}</dt>
          <dd>{formatDate(session.started_at, i18n.language)}</dd>
          <dt>{t('report.sessionNo')}</dt>
          <dd>{header.session_no ?? report.default_session_no}</dd>
          <dt>{t('report.sessionType')}</dt>
          <dd>{header.session_type ? t(`report.sessionTypes.${header.session_type}`) : '—'}</dd>
          <dt>{t('report.setting')}</dt>
          <dd>
            {t(`report.settings.${header.setting}`)} · {t(`report.modes.${header.mode}`)}
          </dd>
          {header.attendees_extra && (
            <>
              <dt>{t('report.attendeesExtra')}</dt>
              <dd>{header.attendees_extra}</dd>
            </>
          )}
          {header.location && (
            <>
              <dt>{t('report.location')}</dt>
              <dd>{header.location}</dd>
            </>
          )}
        </dl>
        {AI_FIELDS.map((code) => (
          <section key={code}>
            <h3>{t(`report.fields.${code}`)}</h3>
            {report.content.ai[code].statements.length === 0 ? (
              <p className="muted small">{t('report.notDiscussed')}</p>
            ) : (
              <ul>
                {report.content.ai[code].statements.map((s) => (
                  <li key={s.id}>{s.text}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
        {THERAPIST_FIELDS.filter((code) => report.content.therapist[code].trim()).map((code) => (
          <section key={code}>
            <h3>{t(`report.fields.${code}`)}</h3>
            <p className="pre-line">{report.content.therapist[code]}</p>
          </section>
        ))}
        <p className="muted small">
          {report.ai_assisted ? t('report.footerAi') : t('report.footerManual')}{' '}
          {t('report.footerApproved', { date: formatDate(report.approved_at ?? '', i18n.language) })}
        </p>
      </article>

      <div className="card stack">
        <h2>{t('report.addenda')}</h2>
        {addenda.length === 0 && <p className="muted small">{t('report.noAddenda')}</p>}
        <ul className="addenda">
          {addenda.map((v) => (
            <li key={v.version}>
              <span className="muted small">{formatDate(v.created_at, i18n.language)}</span>
              <p className="pre-line">{v.text}</p>
            </li>
          ))}
        </ul>
        <label className="report-field no-print">
          <span className="field-label">{t('report.newAddendum')}</span>
          <textarea value={text} rows={3} maxLength={5000} onChange={(e) => setText(e.target.value)} />
        </label>
        {addendum.error && (
          <p className="form-error" role="alert">
            {errorMessage(t, addendum.error instanceof ApiError ? addendum.error.code : 'unknown')}
          </p>
        )}
        <div className="actions no-print">
          <button
            className="secondary"
            disabled={!text.trim() || addendum.isPending}
            onClick={() => addendum.mutate(text, { onSuccess: () => setText('') })}
          >
            {t('report.addAddendum')}
          </button>
        </div>
      </div>
    </div>
  )
}
