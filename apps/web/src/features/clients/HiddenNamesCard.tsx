import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../api/client'
import { useHiddenNames, useSaveHiddenNames } from '../../api/reports'
import { errorMessage } from '../../i18n/errors'

/** Other people's names, replaced by placeholders before AI drafting (ADR 0007). */
export function HiddenNamesCard({ clientId }: { clientId: string }) {
  const { t } = useTranslation()
  const { data } = useHiddenNames(clientId)
  const save = useSaveHiddenNames(clientId)
  const [name, setName] = useState('')
  const names = data?.names ?? []

  function add() {
    const value = name.trim()
    if (!value) return
    save.mutate([...names, value], { onSuccess: () => setName('') })
  }

  return (
    <div className="card stack">
      <h2>{t('hiddenNames.title')}</h2>
      <p className="muted small">{t('hiddenNames.hint')}</p>
      {names.length > 0 && (
        <ul className="chips">
          {names.map((n) => (
            <li key={n} className="chip">
              <span className="chip-text">{n}</span>
              <button
                className="link small"
                aria-label={t('hiddenNames.remove', { name: n })}
                disabled={save.isPending}
                onClick={() => save.mutate(names.filter((x) => x !== n))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input
          aria-label={t('hiddenNames.add')}
          placeholder={t('hiddenNames.placeholder')}
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="secondary" type="submit" disabled={!name.trim() || save.isPending}>
          {t('hiddenNames.add')}
        </button>
      </form>
      {save.error && (
        <p className="form-error" role="alert">
          {errorMessage(t, save.error instanceof ApiError ? save.error.code : 'unknown')}
        </p>
      )}
    </div>
  )
}
