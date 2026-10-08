import { useTranslation } from 'react-i18next'
import { NAV_ICONS, type NavKey } from './nav'

export function PlaceholderPage({ navKey }: { navKey: NavKey }) {
  const { t } = useTranslation()
  const Icon = NAV_ICONS[navKey]
  return (
    <section className="page">
      <header className="page-header">
        <h1>{t(`nav.${navKey}`)}</h1>
      </header>
      <div className="empty">
        <span className="empty-icon">
          <Icon className="icon" aria-hidden="true" />
        </span>
        <p>{t('common.comingSoon')}</p>
      </div>
    </section>
  )
}
