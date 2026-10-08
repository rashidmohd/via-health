import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useMe } from '../../api/auth'
import { Avatar } from '../../avatar/Avatar'
import { useAvatarMood } from '../../avatar/useAvatarMood'
import { NotesToReview } from './NotesToReview'

export function TodayPage() {
  const { t } = useTranslation()
  const { data: me } = useMe()
  const [hour] = useState(() => new Date().getHours())
  const { mood, nod } = useAvatarMood()
  const greeting = hour < 12 ? 'today.morning' : hour < 18 ? 'today.afternoon' : 'today.evening'
  return (
    <section className="page today">
      <div className="avatar-wrap">
        <Avatar mood={mood} nod={nod} size={160} trackPointer />
        <h1>{t(greeting, { name: me?.display_name ?? '' })}</h1>
        <Link className="button primary large" to="/sessions/new">
          {t('sessions.start')}
        </Link>
      </div>
      <NotesToReview />
    </section>
  )
}
