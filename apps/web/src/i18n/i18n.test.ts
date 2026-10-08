import de from './de.json'
import en from './en.json'
import { ERROR_CODES, errorMessage } from './errors'
import i18n from './index'

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  )
}

describe('translations', () => {
  it('German and English have exactly the same keys', () => {
    expect(keys(de).sort()).toEqual(keys(en).sort())
  })

  it('every backend error code has a message in both languages', () => {
    for (const code of ERROR_CODES) {
      expect(de.errors).toHaveProperty(code)
      expect(en.errors).toHaveProperty(code)
    }
  })

  it('falls back to a generic message for unknown codes', async () => {
    await i18n.changeLanguage('en')
    expect(errorMessage(i18n.t, 'something_else')).toBe(en.errors.unknown)
    expect(errorMessage(i18n.t, 'consent_missing')).toBe(en.errors.consent_missing)
  })
})
