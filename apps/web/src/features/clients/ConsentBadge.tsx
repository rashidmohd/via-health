import { useTranslation } from 'react-i18next'
import type { ClientSummary } from '../../api/clients'

/** Overall recording readiness. Always text, never colour alone. */
export function ReadinessBadge({ client }: { client: ClientSummary }) {
  const { t } = useTranslation()
  if (client.status !== 'active') {
    return <span className="badge neutral">{t(`clients.status.${client.status}`)}</span>
  }
  if (client.ready_to_record) {
    return <span className="badge info">{t('consent.ready')}</span>
  }
  const withdrawn =
    client.consent.recording === 'withdrawn' || client.consent.ai_processing === 'withdrawn'
  return (
    <span className="badge attention">{t(withdrawn ? 'consent.withdrawnShort' : 'consent.missingShort')}</span>
  )
}
