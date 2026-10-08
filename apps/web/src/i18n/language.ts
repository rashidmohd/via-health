import i18n from './index'
import type { Language } from '../api/auth'

const STORAGE_KEY = 'sessio.language'

export function storedLanguage(): Language | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'de' || value === 'en' ? value : null
  } catch {
    return null
  }
}

export function currentLanguage(): Language {
  return i18n.language.startsWith('en') ? 'en' : 'de'
}

export function setLanguage(language: Language): void {
  void i18n.changeLanguage(language)
  document.documentElement.lang = language
  try {
    localStorage.setItem(STORAGE_KEY, language)
  } catch {
    // Private mode or blocked storage: language still applies for this visit.
  }
}
