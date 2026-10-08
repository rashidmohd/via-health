import { useTranslation } from 'react-i18next'
import type { NavKey } from './nav'

export function PlaceholderPage({ navKey }: { navKey: NavKey }) {
  const { t } = useTranslation()
  return (
    <section>
      <h1>{t(`nav.${navKey}`)}</h1>
      <p>{t('common.comingSoon')}</p>
    </section>
  )
}
