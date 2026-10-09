import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { preloadLiveModels, usePreloadState } from '../../live-stt/modelCache'
import { livePreviewSupported } from '../../live-stt/preview'
import { useDeviceSetting } from '../settings/deviceSettings'

/**
 * Downloads the live transcript model when the app opens (ADR 0014) and shows the progress at
 * the top. Off in Settings, or when the live preview is off on this device.
 */
export function ModelPreloadBanner() {
  const { t, i18n } = useTranslation()
  const [preload] = useDeviceSetting('livePreload')
  const [livePreview] = useDeviceSetting('livePreview')
  const state = usePreloadState()
  const [dismissed, setDismissed] = useState(false)
  const wanted = preload && livePreview && livePreviewSupported()

  useEffect(() => {
    if (wanted) void preloadLiveModels(i18n.language)
  }, [wanted, i18n.language])

  if (!wanted || dismissed || (state.status !== 'loading' && state.status !== 'error')) return null

  const percent = state.status === 'loading' ? Math.round(state.progress * 100) : 0
  return (
    <div className={`banner preload-banner ${state.status === 'error' ? 'warning' : 'info-banner'}`} role="status">
      <div className="banner-row">
        <span>{state.status === 'error' ? t('preload.failed') : t('preload.loading', { percent })}</span>
        <button type="button" className="icon-button bare" aria-label={t('preload.hide')} onClick={() => setDismissed(true)}>
          <X className="icon" aria-hidden="true" />
        </button>
      </div>
      {state.status === 'loading' && (
        <progress max={100} value={percent} aria-label={t('preload.progress')}>
          {percent} %
        </progress>
      )}
    </div>
  )
}
