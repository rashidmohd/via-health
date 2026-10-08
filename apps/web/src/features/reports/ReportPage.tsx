import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { useReport, useRequestDraft, useSaveReport } from '../../api/reports'
import { useSession, useTranscript } from '../../api/sessions'
import { errorMessage } from '../../i18n/errors'
import { formatDate } from '../format'
import { ReportEditor } from './ReportEditor'
import { ReportView } from './ReportView'

/** Session note (plan 0009): AI draft → therapist review → approval → addenda. */
export function ReportPage() {
  const { id = '' } = useParams()
  const { t, i18n } = useTranslation()
  const { data: session, error: sessionError } = useSession(id)
  const hasTranscript = session?.status === 'transcribed'
  const { data: transcript } = useTranscript(id, hasTranscript)
  const { data: report, error } = useReport(id, Boolean(session))
  const requestDraft = useRequestDraft(id)
  const startManual = useSaveReport(id)

  const failure = sessionError ?? error
  if (failure) {
    return (
      <section className="page">
        <Link to={`/sessions/${id}`} className="back">
          ← {t('nav.sessions')}
        </Link>
        <p className="form-error" role="alert">
          {errorMessage(t, failure instanceof ApiError ? failure.code : 'unknown')}
        </p>
      </section>
    )
  }
  if (!session || !report) return <p className="muted">{t('common.loading')}</p>

  const mutationError = requestDraft.error ?? startManual.error
  const busy = report.status === 'pending' || report.status === 'drafting'
  const start = report.status === 'none' || report.status === 'failed' || report.status === 'no_consent'

  return (
    <section className={`page ${report.status === 'draft' ? 'wide' : 'narrow'}`}>
      <Link to={`/sessions/${id}`} className="back">
        ← {t('session.title', { date: formatDate(session.started_at, i18n.language) })}
      </Link>
      <header className="page-header">
        <h1>{t('report.title')}</h1>
        <span className="muted">{session.client_name}</span>
      </header>

      {busy && (
        <div className="card progress" role="status">
          <span className="spinner" aria-hidden="true" />
          <div>
            <strong>{t(report.pending_field ? 'report.draftingField' : 'report.drafting', {
              field: report.pending_field ? t(`report.fields.${report.pending_field}`) : '',
            })}</strong>
            <p className="muted small">{t('report.draftingHint')}</p>
          </div>
        </div>
      )}

      {start && (
        <div className="card stack">
          {report.status === 'failed' && (
            <p className="banner danger" role="alert">
              {t(`report.failure.${report.failure_reason ?? 'unknown'}`, {
                defaultValue: t('report.failure.unknown'),
              })}
            </p>
          )}
          {report.status === 'no_consent' && (
            <p className="banner warning" role="status">
              {t('report.noConsent')}
            </p>
          )}
          {report.status === 'none' && <p>{t('report.startHint')}</p>}
          {!hasTranscript && <p className="muted small">{t('report.needsTranscript')}</p>}
          <div className="actions">
            {report.status !== 'no_consent' && (
              <button
                className="primary"
                disabled={!hasTranscript || requestDraft.isPending}
                onClick={() => requestDraft.mutate(null)}
              >
                {t(report.status === 'failed' ? 'report.tryAgain' : 'report.draftWithAi')}
              </button>
            )}
            <button
              className="secondary"
              disabled={startManual.isPending}
              onClick={() => startManual.mutate(report.content)}
            >
              {t('report.writeManually')}
            </button>
          </div>
          {mutationError && (
            <p className="form-error" role="alert">
              {errorMessage(t, mutationError instanceof ApiError ? mutationError.code : 'unknown')}
            </p>
          )}
        </div>
      )}

      {report.status === 'draft' && (
        <ReportEditor report={report} session={session} transcript={transcript} />
      )}
      {report.status === 'approved' && <ReportView report={report} session={session} />}
    </section>
  )
}
