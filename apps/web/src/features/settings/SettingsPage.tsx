import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useMe } from '../../api/auth'
import { RiveAvatar } from '../../avatar/RiveAvatar'
import { setAvatarSettings, useAvatarSettings, type AvatarKind } from '../../avatar/settings'
import { Initials } from '../../design/Initials'
import { MicPicker } from '../sessions/MicHealth'

/** Settings (plan 0011): profile picture, avatar reactions, microphone. Templates and
 *  hotwords come later. Photo upload: plan 0012. */
export function SettingsPage() {
  const { t } = useTranslation()
  const { data: me } = useMe()
  const settings = useAvatarSettings()

  const options: { kind: AvatarKind; preview: ReactNode }[] = [
    { kind: 'illustrated', preview: <RiveAvatar mood="attentive" size={48} /> },
    { kind: 'initials', preview: <Initials name={me?.display_name ?? ''} size={48} /> },
  ]

  return (
    <section className="page narrow">
      <header className="page-header">
        <h1>{t('nav.settings')}</h1>
      </header>

      <div className="card stack">
        <fieldset className="avatar-choice">
          <legend>
            <h2>{t('settings.avatar.title')}</h2>
          </legend>
          <p className="muted small">{t('settings.avatar.hint')}</p>
          {options.map(({ kind, preview }) => (
            <label key={kind} className={`avatar-option${settings.kind === kind ? ' selected' : ''}`}>
              <input
                type="radio"
                name="avatar"
                checked={settings.kind === kind}
                onChange={() => setAvatarSettings({ kind })}
              />
              {preview}
              <span>
                <strong>{t(`settings.avatar.${kind}`)}</strong>
                <span className="muted small">{t(`settings.avatar.${kind}Hint`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </div>

      <div className="card stack">
        <h2>{t('settings.reactions.title')}</h2>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.nodOnCapture}
            onChange={(event) => setAvatarSettings({ nodOnCapture: event.target.checked })}
          />
          {t('settings.reactions.nod')}
        </label>
        <p className="muted small">{t('settings.reactions.hint')}</p>
      </div>

      <div className="card stack">
        <h2>{t('settings.microphone.title')}</h2>
        <MicPicker />
      </div>
    </section>
  )
}
