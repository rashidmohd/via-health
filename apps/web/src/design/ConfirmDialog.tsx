import { useEffect, useId, useRef, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { answer, usePendingConfirm } from './confirm'

/** Shows the question asked with `confirmDialog()` (design/confirm.ts). Mounted once in the shell. */
export function ConfirmHost() {
  const { t } = useTranslation()
  const current = usePendingConfirm()
  const messageId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!current) return
    const returnTo = document.activeElement as HTMLElement | null
    // Destructive questions start on Cancel, so a stray Enter never deletes anything.
    ;(current.tone === 'primary' ? confirmRef : cancelRef).current?.focus()
    return () => returnTo?.focus?.()
  }, [current])

  // Resolve an open question as "no" if the host goes away.
  useEffect(() => () => answer(false), [])

  if (!current) return null

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      answer(false)
    } else if (event.key === 'Tab') {
      // Keep focus inside the dialog: it only has the two buttons.
      event.preventDefault()
      const next = document.activeElement === cancelRef.current ? confirmRef : cancelRef
      next.current?.focus()
    }
  }

  return (
    <div className="dialog-backdrop" onClick={() => answer(false)}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-describedby={messageId}
        aria-labelledby={messageId}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <p id={messageId} className="dialog-message">
          {current.message}
        </p>
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="secondary" onClick={() => answer(false)}>
            {current.cancelLabel ?? t('common.cancel')}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={current.tone === 'primary' ? 'primary' : 'danger'}
            onClick={() => answer(true)}
          >
            {current.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
