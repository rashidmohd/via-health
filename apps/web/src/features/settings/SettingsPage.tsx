import { ImageUp, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../api/client'
import { useDeletePhoto, useMe, usePhoto, useUpdateMe, useUploadPhoto, type AvatarKind } from '../../api/auth'
import { PhotoAvatar } from '../../avatar/PhotoAvatar'
import { RiveAvatar } from '../../avatar/RiveAvatar'
import { useAvatarSettings } from '../../avatar/settings'
import { Initials } from '../../design/Initials'
import { errorMessage } from '../../i18n/errors'
import { MicPicker } from '../sessions/MicHealth'
import { PhotoCropper } from './PhotoCropper'

/** Settings (plans 0011, 0012): profile picture, avatar reactions, microphone. Templates and
 *  hotwords come later. */
export function SettingsPage() {
  const { t } = useTranslation()
  const { data: me } = useMe()
  const settings = useAvatarSettings()
  const { data: photo } = usePhoto(settings.hasPhoto)
  const update = useUpdateMe()
  const upload = useUploadPhoto()
  const remove = useDeletePhoto()
  const [file, setFile] = useState<File | null>(null)

  const error = update.error ?? upload.error ?? remove.error
  const options: { kind: AvatarKind; preview: ReactNode; disabled?: boolean }[] = [
    { kind: 'illustrated', preview: <RiveAvatar mood="attentive" size={48} /> },
    { kind: 'initials', preview: <Initials name={me?.display_name ?? ''} size={48} /> },
    {
      kind: 'photo',
      preview: photo ? <PhotoAvatar src={photo} size={48} /> : <span className="photo-empty" aria-hidden="true" />,
      disabled: !settings.hasPhoto,
    },
  ]

  return (
    <section className="page narrow">
      <header className="page-header">
        <h1>{t('nav.settings')}</h1>
      </header>

      {error && (
        <p className="banner danger" role="alert">
          {errorMessage(t, error instanceof ApiError ? error.code : 'unknown')}
        </p>
      )}

      <div className="card stack">
        <fieldset className="avatar-choice">
          <legend>
            <h2>{t('settings.avatar.title')}</h2>
          </legend>
          <p className="muted small">{t('settings.avatar.hint')}</p>
          {options.map(({ kind, preview, disabled }) => (
            <label
              key={kind}
              className={`avatar-option${settings.kind === kind ? ' selected' : ''}${disabled ? ' disabled' : ''}`}
            >
              <input
                type="radio"
                name="avatar"
                checked={settings.kind === kind}
                disabled={disabled || update.isPending}
                onChange={() => update.mutate({ avatar_kind: kind })}
              />
              {preview}
              <span>
                <strong>{t(`settings.avatar.${kind}`)}</strong>
                <span className="muted small">{t(`settings.avatar.${kind}Hint`)}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {file ? (
          <PhotoCropper
            file={file}
            busy={upload.isPending}
            onCancel={() => setFile(null)}
            onSave={(blob) => upload.mutate(blob, { onSuccess: () => setFile(null) })}
          />
        ) : (
          <div className="actions">
            <label className="button secondary file-button">
              <ImageUp className="icon" aria-hidden="true" />
              {t(settings.hasPhoto ? 'settings.avatar.changePhoto' : 'settings.avatar.choosePhoto')}
              <input
                type="file"
                accept="image/*"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null)
                  event.target.value = ''
                }}
              />
            </label>
            {settings.hasPhoto && (
              <button
                className="ghost"
                disabled={remove.isPending}
                onClick={() => window.confirm(t('settings.avatar.removeConfirm')) && remove.mutate()}
              >
                <Trash2 className="icon" aria-hidden="true" />
                {t('settings.avatar.removePhoto')}
              </button>
            )}
          </div>
        )}

        {settings.kind === 'photo' && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.tilt}
              disabled={update.isPending}
              onChange={(event) => update.mutate({ avatar_tilt: event.target.checked })}
            />
            {t('settings.avatar.tilt')}
          </label>
        )}
      </div>

      <div className="card stack">
        <h2>{t('settings.reactions.title')}</h2>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.nodOnCapture}
            disabled={update.isPending}
            onChange={(event) => update.mutate({ avatar_reactions: event.target.checked })}
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
