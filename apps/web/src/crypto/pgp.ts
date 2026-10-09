import type * as openpgp from 'openpgp'

/** OpenPGP wrappers (plan 0014). Nothing self-made: openpgp.js with v6 keys (Ed25519/X25519),
 *  the therapist private key protected by the passphrase through Argon2. Callers get armored
 *  strings and stable error codes, never openpgp error text (it can quote data).
 *  openpgp.js (~400 KB) is loaded on first use, not with the app. */

async function pgp() {
  const lib = await import('openpgp')
  const config: openpgp.PartialConfig = { v6Keys: true, s2kType: lib.enums.s2k.argon2, aeadProtect: true }
  return { lib, config }
}

export type PgpErrorCode = 'passphrase_wrong' | 'key_invalid' | 'decrypt_failed' | 'signature_invalid'

export class PgpError extends Error {
  readonly code: PgpErrorCode

  constructor(code: PgpErrorCode) {
    super(code)
    this.code = code
  }
}

export interface KeyPair {
  publicKey: string
  privateKey: string
  fingerprint: string
}

export type UnlockedKey = openpgp.PrivateKey

/** Last 8 fingerprint characters as "ABCD-EF12". Written into the recovery file; typing it
 *  back shows the file was saved and opened (onboarding check). */
export function checkCode(fingerprint: string): string {
  const tail = fingerprint.slice(-8).toUpperCase()
  return `${tail.slice(0, 4)}-${tail.slice(4)}`
}

export function sameCheckCode(typed: string, fingerprint: string): boolean {
  return typed.toUpperCase().replace(/[^0-9A-F]/g, '') === fingerprint.slice(-8).toUpperCase()
}

/** Therapist key: the private key leaves this function passphrase-encrypted only. */
export async function createTherapistKey(passphrase: string): Promise<KeyPair> {
  const { lib, config } = await pgp()
  const { privateKey, publicKey } = await lib.generateKey({
    type: 'curve25519',
    userIDs: [{ name: 'Sessio therapist key' }],
    passphrase,
    format: 'armored',
    config,
  })
  return { privateKey, publicKey, fingerprint: await fingerprintOf(publicKey) }
}

/** Recovery key: the private key is for offline storage (file), so it has no passphrase.
 *  Only its public key is ever sent to the server. */
export async function createRecoveryKey(): Promise<KeyPair> {
  const { lib, config } = await pgp()
  const key = await lib.generateKey({
    type: 'curve25519',
    userIDs: [{ name: 'Sessio recovery key' }],
    format: 'object',
    config,
  })
  const fingerprint = key.publicKey.getFingerprint()
  const comment = { ...lib.config, showComment: true, commentString: `Sessio recovery key - check code ${checkCode(fingerprint)}` }
  return {
    privateKey: key.privateKey.armor(comment),
    publicKey: key.publicKey.armor(),
    fingerprint,
  }
}

export async function fingerprintOf(armoredKey: string): Promise<string> {
  const { lib } = await pgp()
  try {
    return (await lib.readKey({ armoredKey })).getFingerprint()
  } catch {
    throw new PgpError('key_invalid')
  }
}

/** Decrypts the therapist private key with the passphrase. Keep the result in memory only
 *  (crypto/keyring.ts). */
export async function unlockPrivateKey(armoredKey: string, passphrase: string): Promise<UnlockedKey> {
  const { lib } = await pgp()
  let locked: openpgp.PrivateKey
  try {
    locked = await lib.readPrivateKey({ armoredKey })
  } catch {
    throw new PgpError('key_invalid')
  }
  try {
    return await lib.decryptKey({ privateKey: locked, passphrase })
  } catch {
    throw new PgpError('passphrase_wrong')
  }
}

/** Reads the recovery private key from the saved file (unencrypted by design). */
export async function readRecoveryKey(armoredKey: string): Promise<UnlockedKey> {
  const { lib } = await pgp()
  try {
    const key = await lib.readPrivateKey({ armoredKey })
    if (!key.isDecrypted()) throw new PgpError('key_invalid')
    return key
  } catch {
    throw new PgpError('key_invalid')
  }
}

export interface Recipients {
  therapist: string
  recovery: string
}

/** Rule 7: a record is signed by the therapist key and encrypted to the therapist AND the
 *  recovery key. Both recipients are required. */
export async function signAndEncrypt(text: string, signingKey: UnlockedKey, recipients: Recipients): Promise<string> {
  if (!recipients.therapist || !recipients.recovery) throw new PgpError('key_invalid')
  const { lib, config } = await pgp()
  let encryptionKeys: openpgp.Key[]
  try {
    encryptionKeys = await Promise.all(
      [recipients.therapist, recipients.recovery].map((armoredKey) => lib.readKey({ armoredKey })),
    )
  } catch {
    throw new PgpError('key_invalid')
  }
  return lib.encrypt({
    message: await lib.createMessage({ text }),
    encryptionKeys,
    signingKeys: signingKey,
    config,
  })
}

/** Decrypts a record and checks it was signed by `signerPublicKey`. */
export async function decryptAndVerify(
  armoredMessage: string,
  decryptionKey: UnlockedKey,
  signerPublicKey: string,
): Promise<string> {
  const { lib, config } = await pgp()
  let message: openpgp.Message<string>
  let verificationKeys: openpgp.Key
  try {
    message = await lib.readMessage({ armoredMessage })
    verificationKeys = await lib.readKey({ armoredKey: signerPublicKey })
  } catch {
    throw new PgpError('decrypt_failed')
  }
  let result: Awaited<ReturnType<typeof lib.decrypt<string>>>
  try {
    result = await lib.decrypt({ message, decryptionKeys: decryptionKey, verificationKeys, config })
  } catch {
    throw new PgpError('decrypt_failed')
  }
  try {
    if (result.signatures.length === 0) throw new PgpError('signature_invalid')
    await Promise.all(result.signatures.map((signature) => signature.verified))
  } catch {
    throw new PgpError('signature_invalid')
  }
  return result.data
}

/** Best effort: drop the decrypted private key material (on lock). */
export function forgetKey(key: UnlockedKey): void {
  try {
    // Present at runtime on openpgp.js private keys, missing from its type definitions.
    ;(key as UnlockedKey & { clearPrivateParams(): void }).clearPrivateParams()
  } catch {
    // already cleared or not decrypted
  }
}
