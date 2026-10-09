import { useTranslation } from 'react-i18next'
import { useMyKeys } from '../../api/keys'
import { useReport } from '../../api/reports'
import type { ServerSession } from '../../api/sessions'
import { errorCode, errorMessage } from '../../i18n/errors'
import { UnlockPanel } from '../keys/UnlockPanel'
import { useOpenedReport } from '../reports/useOpened'
import { TranscriptView } from './TranscriptView'

/** After signing the transcript exists only in the signed record (plan 0014). */
export function SignedTranscript({ session }: { session: ServerSession }) {
  const { t } = useTranslation()
  const { data: keys } = useMyKeys()
  const { data: report } = useReport(session.id)
  const opened = useOpenedReport(report, keys)

  if (!keys || !report?.signed?.transcript) return null
  if (opened.data?.transcript) {
    return <TranscriptView sessionId={session.id} transcript={opened.data.transcript} clientName={session.client_name} readOnly />
  }
  if (opened.error) {
    return (
      <p className="form-error" role="alert">
        {errorMessage(t, errorCode(opened.error))}
      </p>
    )
  }
  if (opened.isFetching) return <p className="muted" role="status">{t('report.opening')}</p>
  return <UnlockPanel keys={keys} title={t('report.unlockToRead')} hint={t('report.unlockToReadHint')} autoFocus={false} />
}
