import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import de from './de.json'
import en from './en.json'

export const SUPPORTED_LANGUAGES = ['de', 'en'] as const

function initialLanguage(): 'de' | 'en' {
  try {
    const stored = localStorage.getItem('sessio.language')
    if (stored === 'de' || stored === 'en') return stored
  } catch {
    // Storage unavailable: fall back to the browser language.
  }
  return navigator.language.startsWith('en') ? 'en' : 'de'
}

void i18n.use(initReactI18next).init({
  resources: { de: { translation: de }, en: { translation: en } },
  lng: initialLanguage(),
  fallbackLng: 'de',
  interpolation: { escapeValue: false },
})

export default i18n
