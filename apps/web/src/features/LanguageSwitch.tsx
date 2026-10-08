import { useTranslation } from 'react-i18next'
import { useMe, useUpdateMe, type Language } from '../api/auth'
import { currentLanguage, setLanguage } from '../i18n/language'

const LANGUAGES: Language[] = ['de', 'en']

export function LanguageSwitch() {
  const { t } = useTranslation()
  const { data: me } = useMe()
  const updateMe = useUpdateMe()
  const active = currentLanguage()

  function choose(language: Language) {
    setLanguage(language)
    if (me) updateMe.mutate({ ui_language: language })
  }

  return (
    <div className="language-switch" role="group" aria-label={t('language.label')}>
      {LANGUAGES.map((language) => (
        <button
          key={language}
          type="button"
          aria-pressed={active === language}
          onClick={() => choose(language)}
        >
          {language.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
