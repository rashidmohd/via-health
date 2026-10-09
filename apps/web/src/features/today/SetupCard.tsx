import { KeyRound, UserPlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useMe } from '../../api/auth'
import { useClients } from '../../api/clients'
import inviteOnly from '../../design/illustrations/invite-only.svg'
import niceToMeetYou from '../../design/illustrations/nice-to-meet-you.svg'

/**
 * The next first-run step on Today, one at a time: keys first (signing needs them, plan 0014),
 * then the first client. Gone once both are done. The one illustration allowed on Today (ADR 0015).
 */
export function SetupCard() {
  const { t } = useTranslation()
  const { data: me } = useMe()
  const { data: clients } = useClients()
  if (!me) return null

  if (me.has_keys === false) {
    return (
      <div className="setup-card warning" role="status">
        <img className="setup-card-illustration" src={inviteOnly} alt="" aria-hidden="true" />
        <div className="setup-card-text">
          <h2>{t('keys.missing.title')}</h2>
          <p>{t('keys.missing.body')}</p>
        </div>
        <Link className="button primary" to="/keys">
          <KeyRound className="icon" aria-hidden="true" />
          {t('keys.missing.action')}
        </Link>
      </div>
    )
  }

  if (Array.isArray(clients) && clients.length === 0) {
    return (
      <div className="setup-card">
        <img className="setup-card-illustration" src={niceToMeetYou} alt="" aria-hidden="true" />
        <div className="setup-card-text">
          <h2>{t('today.firstClient.title')}</h2>
          <p>{t('today.firstClient.body')}</p>
        </div>
        <Link className="button primary" to="/clients/new">
          <UserPlus className="icon" aria-hidden="true" />
          {t('today.firstClient.action')}
        </Link>
      </div>
    )
  }

  return null
}
