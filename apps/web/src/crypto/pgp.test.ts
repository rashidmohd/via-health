// @vitest-environment node
import * as openpgp from 'openpgp'
import {
  checkCode,
  createRecoveryKey,
  createTherapistKey,
  decryptAndVerify,
  fingerprintOf,
  readRecoveryKey,
  sameCheckCode,
  signAndEncrypt,
  unlockPrivateKey,
  type KeyPair,
  type UnlockedKey,
} from './pgp'

// Argon2 key generation is deliberately slow; give it room when the whole suite runs in parallel.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 })

const PASSPHRASE = 'olive tree quiet harbour'

let therapist: KeyPair
let recovery: KeyPair
let unlocked: UnlockedKey
let recipients: { therapist: string; recovery: string }
let otherKey: UnlockedKey // someone else's key

beforeAll(async () => {
  let other: KeyPair
  ;[therapist, recovery, other] = await Promise.all([
    createTherapistKey(PASSPHRASE),
    createRecoveryKey(),
    createTherapistKey(PASSPHRASE),
  ])
  ;[unlocked, otherKey] = await Promise.all([
    unlockPrivateKey(therapist.privateKey, PASSPHRASE),
    unlockPrivateKey(other.privateKey, PASSPHRASE),
  ])
  recipients = { therapist: therapist.publicKey, recovery: recovery.publicKey }
})

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return (error as { code: string }).code
  }
  return 'no error'
}

describe('keys', () => {
  it('creates v6 keys; the therapist private key is passphrase-protected with Argon2', async () => {
    const key = await openpgp.readPrivateKey({ armoredKey: therapist.privateKey })
    expect(key.keyPacket.version).toBe(6)
    expect(key.isDecrypted()).toBe(false)
    expect((key.keyPacket as typeof key.keyPacket & { s2k: { type: string } }).s2k.type).toBe('argon2')
    expect(therapist.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(await fingerprintOf(therapist.publicKey)).toBe(therapist.fingerprint)
    expect(therapist.publicKey).not.toContain('PRIVATE KEY')
  })

  it('writes the check code into the recovery file', async () => {
    expect(recovery.privateKey).toContain(`check code ${checkCode(recovery.fingerprint)}`)
    expect((await readRecoveryKey(recovery.privateKey)).getFingerprint()).toBe(recovery.fingerprint)
    expect(recovery.publicKey).not.toContain('PRIVATE KEY')
  })

  it('compares check codes loosely (case, dash, spaces)', () => {
    const fp = 'f'.repeat(56) + 'ab12cd34'
    expect(checkCode(fp)).toBe('AB12-CD34')
    expect(sameCheckCode(' ab12 cd34 ', fp)).toBe(true)
    expect(sameCheckCode('AB12-CD35', fp)).toBe(false)
    expect(sameCheckCode('', fp)).toBe(false)
  })

  it('rejects a wrong passphrase', async () => {
    expect(await code(unlockPrivateKey(therapist.privateKey, 'wrong passphrase'))).toBe('passphrase_wrong')
  })

  it('rejects something that is not a key', async () => {
    expect(await code(unlockPrivateKey('not a key', PASSPHRASE))).toBe('key_invalid')
    expect(await code(readRecoveryKey(therapist.privateKey))).toBe('key_invalid') // locked, not a recovery file
  })
})

describe('records', () => {
  it('signs and encrypts to therapist and recovery; both can read it', async () => {
    const message = await signAndEncrypt('Verlaufsnotiz', unlocked, recipients)
    expect(message).not.toContain('Verlaufsnotiz')
    expect(await decryptAndVerify(message, unlocked, therapist.publicKey)).toBe('Verlaufsnotiz')
    const recoveryKey = await readRecoveryKey(recovery.privateKey)
    expect(await decryptAndVerify(message, recoveryKey, therapist.publicKey)).toBe('Verlaufsnotiz')
  })

  it('refuses to encrypt without the recovery recipient', async () => {
    expect(await code(signAndEncrypt('x', unlocked, { therapist: therapist.publicKey, recovery: '' }))).toBe('key_invalid')
  })

  it('cannot be read with a wrong key', async () => {
    const message = await signAndEncrypt('x', unlocked, recipients)
    expect(await code(decryptAndVerify(message, otherKey, therapist.publicKey))).toBe('decrypt_failed')
  })

  it('detects tampered ciphertext', async () => {
    const bytes = await openpgp.encrypt({
      message: await openpgp.createMessage({ text: 'Verlaufsnotiz' }),
      encryptionKeys: await openpgp.readKey({ armoredKey: therapist.publicKey }),
      signingKeys: unlocked,
      format: 'binary',
    })
    bytes[bytes.length - 20] ^= 0x01 // inside the encrypted, authenticated data
    const tampered = await openpgp.readMessage({ binaryMessage: bytes }).then((m) => m.armor())
    expect(await code(decryptAndVerify(tampered, unlocked, therapist.publicKey))).toBe('decrypt_failed')
  })

  it('detects a signature by another key', async () => {
    const forged = await signAndEncrypt('x', otherKey, recipients)
    expect(await code(decryptAndVerify(forged, unlocked, therapist.publicKey))).toBe('signature_invalid')
  })

  it('detects a missing signature', async () => {
    const unsigned = await openpgp.encrypt({
      message: await openpgp.createMessage({ text: 'x' }),
      encryptionKeys: await openpgp.readKey({ armoredKey: therapist.publicKey }),
    })
    expect(await code(decryptAndVerify(unsigned, unlocked, therapist.publicKey))).toBe('signature_invalid')
  })
})
