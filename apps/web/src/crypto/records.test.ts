// @vitest-environment node
import type { Keys } from '../api/keys'
import { createRecoveryKey, createTherapistKey, decryptAndVerify, readRecoveryKey, unlockPrivateKey, type UnlockedKey } from './pgp'
import { openRecord, signAddendum, signNote, type SignPrepared } from './records'

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 })

const PASSPHRASE = 'olive tree quiet harbour'

let keys: Keys
let unlocked: UnlockedKey
let recoveryPrivate: string

const prepared = (): SignPrepared => ({
  note: { content: { therapist: { notable: 'Fortschritt' } }, approved_at: '2026-10-09T10:00:00Z' },
  index: { session_no: '3', session_type: null, topics: ['Schlaf'] },
  transcript: { segments: [{ speaker: '1', start_ms: 0, end_ms: 900, text: 'Hallo' }] },
  addenda: [{ version: 2, created_at: '2026-10-09T11:00:00Z', text: 'Nachtrag' }],
  approved_at: '2026-10-09T10:00:00Z',
  report_updated_at: '2026-10-09T09:59:00Z',
  therapist_fingerprint: keys.therapist_fingerprint,
  recovery_fingerprint: keys.recovery_fingerprint,
})

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return (error as { code: string }).code
  }
  return 'no error'
}

beforeAll(async () => {
  const [therapist, recovery] = await Promise.all([createTherapistKey(PASSPHRASE), createRecoveryKey()])
  unlocked = await unlockPrivateKey(therapist.privateKey, PASSPHRASE)
  recoveryPrivate = recovery.privateKey
  keys = {
    therapist_public_key: therapist.publicKey,
    therapist_private_key: therapist.privateKey,
    recovery_public_key: recovery.publicKey,
    therapist_fingerprint: therapist.fingerprint,
    recovery_fingerprint: recovery.fingerprint,
  }
})

describe('signed notes', () => {
  it('signs note, transcript, index and addenda; the therapist key opens them again', async () => {
    const body = await signNote(prepared(), unlocked, keys)
    expect(body.signer_fingerprint).toBe(keys.therapist_fingerprint)
    expect(body.encrypted_to).toEqual([keys.therapist_fingerprint, keys.recovery_fingerprint])
    expect(body.approved_at).toBe('2026-10-09T10:00:00Z')
    expect(body.report_updated_at).toBe('2026-10-09T09:59:00Z')
    for (const message of [body.note, body.transcript!, body.index, body.addenda[0].message]) {
      expect(message).toMatch(/^-----BEGIN PGP MESSAGE-----/)
      expect(message).not.toContain('Fortschritt')
    }
    expect(await openRecord(body.note, unlocked, keys)).toEqual(prepared().note)
    expect(await openRecord(body.index, unlocked, keys)).toEqual(prepared().index)
    expect(await openRecord(body.transcript!, unlocked, keys)).toEqual(prepared().transcript)
    expect(body.addenda[0].version).toBe(2)
    expect(await openRecord(body.addenda[0].message, unlocked, keys)).toEqual({
      text: 'Nachtrag',
      created_at: '2026-10-09T11:00:00Z',
    })
  })

  it('the recovery key alone opens the record (rule 7)', async () => {
    const body = await signNote(prepared(), unlocked, keys)
    const recovery = await readRecoveryKey(recoveryPrivate)
    const text = await decryptAndVerify(body.note, recovery, keys.therapist_public_key)
    expect(JSON.parse(text)).toEqual(prepared().note)
  })

  it('a note without transcript has none', async () => {
    const body = await signNote({ ...prepared(), transcript: null }, unlocked, keys)
    expect(body.transcript).toBeNull()
  })

  it('refuses keys that are not the ones the server knows', async () => {
    const stale = { ...prepared(), recovery_fingerprint: 'f'.repeat(64) }
    expect(await code(signNote(stale, unlocked, keys))).toBe('key_invalid')
  })

  it('signs an addendum the same way', async () => {
    const signed = await signAddendum('Termin verschoben', unlocked, keys)
    expect(signed.encrypted_to).toEqual([keys.therapist_fingerprint, keys.recovery_fingerprint])
    expect(await openRecord<{ text: string }>(signed.message, unlocked, keys)).toMatchObject({ text: 'Termin verschoben' })
  })
})
