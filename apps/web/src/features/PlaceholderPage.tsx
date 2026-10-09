import { useTranslation } from 'react-i18next'
import workInProgress from '../design/illustrations/work-in-progress.svg'
import type { NavKey } from './nav'

export function PlaceholderPage({ navKey }: { navKey: NavKey }) {
  const { t } = useTranslation()
  return (
    <section className="page">
      <header className="page-header">
        <h1>{t(`nav.${navKey}`)}</h1>
      </header>
      <div className="empty">
        <img className="empty-illustration" src={workInProgress} alt="" aria-hidden="true" />
        <p>{t('common.comingSoon')}</p>
      </div>
    </section>
  )
}
