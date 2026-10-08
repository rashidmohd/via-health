import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import de from './de.json'
import en from './en.json'

export const SUPPORTED_LANGUAGES = ['de', 'en'] as const

void i18n.use(initReactI18next).init({
  resources: { de: { translation: de }, en: { translation: en } },
  lng: navigator.language.startsWith('en') ? 'en' : 'de',
  fallbackLng: 'de',
  interpolation: { escapeValue: false },
})

export default i18n
