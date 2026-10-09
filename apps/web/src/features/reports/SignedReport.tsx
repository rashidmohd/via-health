import { PenLine } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMyKeys } from '../../api/keys'
import { useAddAddendum, type Report } from '../../api/reports'
import type { ServerSession } from '../../api/sessions'
import { ListSkeleton } from '../../design/ListSkeleton'
import { errorCode, errorMessage } from '../../i18n/errors'
import { formatDate } from '../format'
import { UnlockPanel } from '../keys/UnlockPanel'
import { ReportView } from './ReportView'
import { useOpenedReport } from './useOpened'
import { useSignFlow } from './useSignFlow'

/** A signed note (plan 0014): decrypted on this device once the key is unlocked. */
export function SignedReport({ report, session }: { report: Report; session: ServerSession }) {
  const { t, i18n } = useTranslation()
  const { data: keys } = useMyKeys()
  const opened = useOpenedReport(report, keys)
  const addendum = useAddAddendum(session.id)
  const signedAt = report.signed?.signed_at ?? ''

  if (keys === undefined) return <ListSkeleton rows={4} />
  if (keys === null) return <p className="form-error">{errorMessage(t, 'keys_missing')}</p>
  if (!opened.data) {
    if (opened.error) {
      return (
        <p className="form-error" role="alert">
          {errorMessage(t, errorCode(opened.error))}
        </p>
      )
    }
    if (opened.isFetching) return <p className="muted" role="status">{t('report.opening')}</p>
    return <UnlockPanel keys={keys} title={t('report.unlockToRead')} hint={t('report.unlockToReadHint')} />
  }

  const { note, addenda } = opened.data
  return (
    <ReportView
      session={session}
      note={{
        content: note.content,
        aiAssisted: note.ai_assisted,
        approvedAt: note.approved_at,
        signedAt,
        defaultSessionNo: report.default_session_no,
        addenda,
      }}
      notice={
        <p className="banner info-banner" role="status">
          {t('report.signedOn', { date: formatDate(signedAt, i18n.language) })}
        </p>
      }
      addendum={{
        add: (text, onDone) => addendum.mutate({ text, keys }, { onSuccess: onDone }),
        pending: addendum.isPending,
        error: addendum.error,
      }}
    />
  )
}

/** Approved before signing existed (test data): readable on the server until signed now. */
export function ApprovedUnsignedReport({ report, session }: { report: Report; session: ServerSession }) {
  const { t } = useTranslation()
  const flow = useSignFlow(session.id)
  return (
    <ReportView
      session={session}
      note={{
        content: report.content,
        aiAssisted: report.ai_assisted,
        approvedAt: report.approved_at ?? '',
        signedAt: null,
        defaultSessionNo: report.default_session_no,
        addenda: report.versions
          .filter((v) => v.kind === 'addendum')
          .map((v) => ({ version: v.version, created_at: v.created_at, text: v.text ?? '' })),
      }}
      notice={
        <div className="stack no-print">
          <div className="banner warning stack" role="status">
            <p>{t('report.notSigned')}</p>
            {flow.keys === null ? (
              <p>
                {t('report.keysNeeded')}{' '}
                <Link to="/keys">{t('keys.setUp')}</Link>
              </p>
            ) : (
              <div className="actions">
                <button className="primary" disabled={!flow.keys || flow.pending} onClick={() => flow.request()}>
                  <PenLine className="icon" aria-hidden="true" />
                  {t(flow.pending ? 'report.signing' : 'report.signNow')}
                </button>
              </div>
            )}
            {Boolean(flow.error) && (
              <p className="form-error" role="alert">
                {errorMessage(t, errorCode(flow.error))}
              </p>
            )}
          </div>
          {flow.unlockPanel}
        </div>
      }
    />
  )
}
