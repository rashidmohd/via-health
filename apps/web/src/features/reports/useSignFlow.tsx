import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMyKeys } from '../../api/keys'
import { useSignReport } from '../../api/reports'
import { emitAvatarEvent } from '../../avatar/events'
import { unlockedKey } from '../../crypto/keyring'
import { UnlockPanel } from '../keys/UnlockPanel'

/** "Approve and sign": asks for the passphrase first when the key is locked, then signs. */
export function useSignFlow(sessionId: string) {
  const { t } = useTranslation()
  const { data: keys } = useMyKeys()
  const sign = useSignReport(sessionId)
  const [waitingForUnlock, setWaitingForUnlock] = useState(false)

  function run() {
    if (!keys) return
    sign.mutate(keys, { onSuccess: () => emitAvatarEvent('report.signed') })
  }

  /** Returns false when signing cannot start (no keys). */
  function request(): boolean {
    if (!keys) return false
    if (!unlockedKey()) {
      setWaitingForUnlock(true)
      return true
    }
    run()
    return true
  }

  const unlockPanel =
    waitingForUnlock && keys ? (
      <UnlockPanel
        keys={keys}
        title={t('report.unlockToSign')}
        hint={t('report.unlockToSignHint')}
        onUnlocked={() => {
          setWaitingForUnlock(false)
          run()
        }}
      />
    ) : null

  return {
    request,
    unlockPanel,
    /** null: keys not set up; undefined: still loading. */
    keys,
    pending: sign.isPending,
    error: sign.error,
  }
}
