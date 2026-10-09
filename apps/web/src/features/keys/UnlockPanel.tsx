import { LockKeyhole } from 'lucide-react'
import type { Keys } from '../../api/keys'
import { UnlockForm } from './KeysPage'

/** Asks for the passphrase where a key is needed (signing, opening a signed note). */
export function UnlockPanel({
  keys,
  title,
  hint,
  onUnlocked,
  autoFocus = true,
}: {
  keys: Keys
  title: string
  hint: string
  onUnlocked?: () => void
  autoFocus?: boolean
}) {
  return (
    <div className="card stack unlock-panel" role="region" aria-label={title}>
      <h2 className="section-title">
        <LockKeyhole className="icon" aria-hidden="true" />
        {title}
      </h2>
      <p className="muted small">{hint}</p>
      <UnlockForm keys={keys} onUnlocked={onUnlocked} autoFocus={autoFocus} />
    </div>
  )
}
