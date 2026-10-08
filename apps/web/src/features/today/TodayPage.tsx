import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useMe } from '../../api/auth'

export function TodayPage() {
  const { t } = useTranslation()
  const { data: me } = useMe()
  const [hour] = useState(() => new Date().getHours())
  const greeting = hour < 12 ? 'today.morning' : hour < 18 ? 'today.afternoon' : 'today.evening'
  return (
    <section className="page today">
      <h1>{t(greeting, { name: me?.display_name ?? '' })}</h1>
      <Link className="button primary large" to="/sessions/new">
        {t('sessions.start')}
      </Link>
    </section>
  )
}
