import { Printer } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AI_FIELDS, THERAPIST_FIELDS, type ReportContent } from '../../api/reports'
import type { ServerSession } from '../../api/sessions'
import { errorCode, errorMessage } from '../../i18n/errors'
import { formatDate } from '../format'

/** A note as shown read-only: decrypted from the signed record, or (approved before signing
 *  existed) as the server still has it. Statements need only `id` and `text`. */
export interface ReadableNote {
  content: ReportContent
  aiAssisted: boolean
  approvedAt: string
  signedAt: string | null
  defaultSessionNo: number | string | null
  addenda: { version: number; created_at: string; text: string }[]
}

export interface AddendumAction {
  add: (text: string, onDone: () => void) => void
  pending: boolean
  error: unknown
}

/** An approved note: read-only, with dated addenda ("Nachtrag", §630f BGB). Without
 *  `addendum` no new addenda can be written (a note approved but not yet signed). */
export function ReportView({
  note,
  session,
  notice,
  addendum,
}: {
  note: ReadableNote
  session: ServerSession
  notice: ReactNode
  addendum?: AddendumAction
}) {
  const { t, i18n } = useTranslation()
  const [text, setText] = useState('')
  const { header } = note.content
  const lang = i18n.language

  return (
    <div className="stack narrow-report">
      {notice}
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
          <dd>{formatDate(session.started_at, lang)}</dd>
          <dt>{t('report.sessionNo')}</dt>
          <dd>{header.session_no ?? note.defaultSessionNo}</dd>
          <dt>{t('report.sessionType')}</dt>
          <dd>{header.session_type ? t(`report.sessionTypes.${header.session_type}`) : t('report.sessionTypeNone')}</dd>
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
        {AI_FIELDS.map((code) => {
          const statements = note.content.ai[code]?.statements ?? []
          return (
            <section key={code}>
              <h3>{t(`report.fields.${code}`)}</h3>
              {statements.length === 0 ? (
                <p className="muted small">{t('report.notDiscussed')}</p>
              ) : (
                <ul>
                  {statements.map((s) => (
                    <li key={s.id}>{s.text}</li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
        {THERAPIST_FIELDS.filter((code) => note.content.therapist[code]?.trim()).map((code) => (
          <section key={code}>
            <h3>{t(`report.fields.${code}`)}</h3>
            <p className="pre-line">{note.content.therapist[code]}</p>
          </section>
        ))}
        <p className="muted small">
          {note.aiAssisted ? t('report.footerAi') : t('report.footerManual')}{' '}
          {note.signedAt
            ? t('report.footerSigned', { date: formatDate(note.signedAt, lang) })
            : t('report.footerApproved', { date: formatDate(note.approvedAt, lang) })}
        </p>
      </article>

      <div className="card stack">
        <h2>{t('report.addenda')}</h2>
        {note.addenda.length === 0 && <p className="muted small">{t('report.noAddenda')}</p>}
        <ul className="addenda">
          {note.addenda.map((v) => (
            <li key={v.version}>
              <span className="muted small">{formatDate(v.created_at, lang)}</span>
              <p className="pre-line">{v.text}</p>
            </li>
          ))}
        </ul>
        {addendum && (
          <>
            <label className="report-field no-print">
              <span className="field-label">{t('report.newAddendum')}</span>
              <textarea value={text} rows={3} maxLength={5000} onChange={(e) => setText(e.target.value)} />
            </label>
            {Boolean(addendum.error) && (
              <p className="form-error" role="alert">
                {errorMessage(t, errorCode(addendum.error))}
              </p>
            )}
            <div className="actions no-print">
              <button
                className="secondary"
                disabled={!text.trim() || addendum.pending}
                onClick={() => addendum.add(text.trim(), () => setText(''))}
              >
                {t('report.addAddendum')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
