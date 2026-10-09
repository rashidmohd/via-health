import { ImageUp } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDescribePhoto } from '../../api/auth'
import { ApiError } from '../../api/client'
import { BEARDS, GLASSES, HAIR_STYLES, type Appearance } from '../../avatar/appearance'
import { RiveAvatar } from '../../avatar/RiveAvatar'
import { errorMessage } from '../../i18n/errors'
import { PhotoCropper } from './PhotoCropper'

type ColorField = 'hair_color' | 'skin_color' | 'eye_color'
const COLORS: ColorField[] = ['hair_color', 'skin_color', 'eye_color']

/**
 * Drawn avatar (ADR 0013): start from a photo (the AI suggests parts and colours, the photo is
 * not stored) or from the current look, then adjust everything by hand before saving.
 */
export function AppearanceEditor({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: Appearance
  busy: boolean
  onSave: (appearance: Appearance) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [appearance, setAppearance] = useState(initial)
  const [file, setFile] = useState<File | null>(null)
  const [suggested, setSuggested] = useState(false)
  const describe = useDescribePhoto()

  const set = (change: Partial<Appearance>) => setAppearance((current) => ({ ...current, ...change }))

  if (file) {
    return (
      <PhotoCropper
        file={file}
        busy={describe.isPending}
        onCancel={() => setFile(null)}
        onSave={(photo) =>
          describe.mutate(photo, {
            onSuccess: (result) => {
              setAppearance(result)
              setSuggested(true)
              setFile(null)
            },
            onError: () => setFile(null),
          })
        }
      />
    )
  }

  return (
    <div className="appearance-editor stack">
      <h3>{t('settings.avatar.editor.title')}</h3>
      {describe.error && (
        <p className="banner danger" role="alert">
          {errorMessage(t, describe.error instanceof ApiError ? describe.error.code : 'unknown')}
        </p>
      )}
      {suggested && (
        <p className="banner info" role="status">
          {t('settings.avatar.editor.suggested')}
        </p>
      )}
      <div className="appearance-layout">
        <div className="appearance-preview">
          <RiveAvatar mood="welcome" appearance={appearance} size={120} />
        </div>
        <div className="appearance-fields">
          <label>
            {t('settings.avatar.editor.hairStyle')}
            <select
              value={appearance.hair_style}
              onChange={(event) => set({ hair_style: event.target.value as Appearance['hair_style'] })}
            >
              {HAIR_STYLES.map((style) => (
                <option key={style} value={style}>
                  {t(`settings.avatar.hair.${style}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('settings.avatar.editor.glasses')}
            <select
              value={appearance.glasses}
              onChange={(event) => set({ glasses: event.target.value as Appearance['glasses'] })}
            >
              {GLASSES.map((value) => (
                <option key={value} value={value}>
                  {t(`settings.avatar.glassesOptions.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('settings.avatar.editor.beard')}
            <select
              value={appearance.beard}
              onChange={(event) => set({ beard: event.target.value as Appearance['beard'] })}
            >
              {BEARDS.map((value) => (
                <option key={value} value={value}>
                  {t(`settings.avatar.beardOptions.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="appearance-colors">
            {COLORS.map((field) => (
              <label key={field} className="color-field">
                <input
                  type="color"
                  value={appearance[field]}
                  onChange={(event) => set({ [field]: event.target.value.toLowerCase() })}
                />
                {t(`settings.avatar.editor.${field}`)}
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="actions">
        <label className="button secondary file-button">
          <ImageUp className="icon" aria-hidden="true" />
          {describe.isPending ? t('settings.avatar.editor.describing') : t('settings.avatar.editor.fromPhoto')}
          <input
            type="file"
            accept="image/*"
            disabled={describe.isPending}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null)
              event.target.value = ''
            }}
          />
        </label>
      </div>
      <p className="muted small">{t('settings.avatar.editor.privacy')}</p>
      <div className="actions">
        <button className="primary" disabled={busy || describe.isPending} onClick={() => onSave(appearance)}>
          {t('settings.avatar.editor.save')}
        </button>
        <button className="secondary" disabled={busy} onClick={onCancel}>
          {t('settings.avatar.editor.cancel')}
        </button>
      </div>
    </div>
  )
}
