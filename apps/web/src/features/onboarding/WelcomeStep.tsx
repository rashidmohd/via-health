import { FileText, KeyRound, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import type { Me } from '../../api/auth'
import hello from '../../design/illustrations/hello.svg'
import { Logo } from '../../design/Logo'
import { markWelcomeSeen, startTour } from './onboarding'

/** Shown once after the name step: what Sessio does, then the tour or straight to Today. */
export function WelcomeStep({ me }: { me: Me }) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  function finish(tour: boolean) {
    markWelcomeSeen(me.id)
    navigate('/')
    if (tour) startTour()
  }

  const points = [
    { icon: ShieldCheck, key: 'record' },
    { icon: FileText, key: 'notes' },
    { icon: KeyRound, key: 'keys' },
  ] as const

  return (
    <div className="auth-page">
      <div className="auth-card welcome-card">
        <span className="brand">
          <Logo />
        </span>
        <img className="welcome-illustration" src={hello} alt="" aria-hidden="true" />
        <div className="auth-heading">
          <h1>{t('welcome.title', { name: me.display_name })}</h1>
          <p className="muted">{t('welcome.intro')}</p>
        </div>
        <ul className="welcome-points">
          {points.map(({ icon: Icon, key }) => (
            <li key={key}>
              <Icon className="icon" aria-hidden="true" />
              <span>{t(`welcome.points.${key}`)}</span>
            </li>
          ))}
        </ul>
        <div className="welcome-actions">
          <button type="button" className="primary" onClick={() => finish(true)}>
            {t('welcome.tour')}
          </button>
          <button type="button" className="secondary" onClick={() => finish(false)}>
            {t('welcome.skip')}
          </button>
        </div>
      </div>
    </div>
  )
}
