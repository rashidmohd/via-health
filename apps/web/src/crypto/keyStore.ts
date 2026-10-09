import Dexie, { type Table } from 'dexie'
import type { Keys } from '../api/keys'

/** Device copy of the keys (plan 0014), so the key can be unlocked offline. Same data as on
 *  the server: public keys and the passphrase-encrypted private key — never a usable key. */

interface DeviceKeys extends Keys {
  userId: string
}

class KeyDb extends Dexie {
  keys!: Table<DeviceKeys, string>

  constructor() {
    super('sessio-keys')
    this.version(1).stores({ keys: 'userId' })
  }
}

const keyDb = new KeyDb()

export async function saveDeviceKeys(userId: string, keys: Keys): Promise<void> {
  await keyDb.keys.put({ ...keys, userId })
}

export async function loadDeviceKeys(userId: string): Promise<Keys | null> {
  const stored = await keyDb.keys.get(userId)
  if (!stored) return null
  const { userId: _userId, ...keys } = stored
  return keys
}
