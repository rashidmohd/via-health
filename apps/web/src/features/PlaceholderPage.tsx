import { useTranslation } from 'react-i18next'
import securityOn from '../design/illustrations/security-on.svg'
import workInProgress from '../design/illustrations/work-in-progress.svg'
import type { NavKey } from './nav'

// Each unbuilt page gets its own picture so they don't all look alike (ADR 0015).
const ILLUSTRATIONS: Partial<Record<NavKey, string>> = {
  keys: securityOn,
}

export function PlaceholderPage({ navKey }: { navKey: NavKey }) {
  const { t } = useTranslation()
  return (
    <section className="page">
      <header className="page-header">
        <h1>{t(`nav.${navKey}`)}</h1>
      </header>
      <div className="empty">
        <img className="empty-illustration" src={ILLUSTRATIONS[navKey] ?? workInProgress} alt="" aria-hidden="true" />
        <p>{t('common.comingSoon')}</p>
      </div>
    </section>
  )
}
