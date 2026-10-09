import type { Keys } from '../api/keys'
import { decryptAndVerify, PgpError, signAndEncrypt, type UnlockedKey } from './pgp'

/** Signed records (plan 0014 step B, rule 7). The browser signs the note, its transcript and a
 *  small index with the therapist key and encrypts each to the therapist AND recovery key. The
 *  server stores the messages and cannot read them; everything shown afterwards is decrypted
 *  here. Records are JSON, so a recovery tool needs nothing but the recovery key. */

/** What `POST /sessions/{id}/report/sign/prepare` returns: the record to sign, unchanged. */
export interface SignPrepared {
  note: Record<string, unknown>
  index: Record<string, unknown>
  transcript: Record<string, unknown> | null
  /** Addenda of a note approved before signing existed; signed along with it. */
  addenda: { version: number; created_at: string; text: string }[]
  approved_at: string
  report_updated_at: string
  therapist_fingerprint: string
  recovery_fingerprint: string
}

export interface SignedBy {
  signer_fingerprint: string
  encrypted_to: [string, string]
}

export interface SignBody extends SignedBy {
  note: string
  transcript: string | null
  index: string
  addenda: { version: number; message: string }[]
  approved_at: string
  report_updated_at: string
}

/** The keys this device holds must be the ones the server knows (e.g. no stale device copy). */
function checkKeys(keys: Keys, therapist: string, recovery: string): void {
  if (keys.therapist_fingerprint !== therapist || keys.recovery_fingerprint !== recovery) {
    throw new PgpError('key_invalid')
  }
}

function signedBy(keys: Keys): SignedBy {
  return { signer_fingerprint: keys.therapist_fingerprint, encrypted_to: [keys.therapist_fingerprint, keys.recovery_fingerprint] }
}

async function seal(value: unknown, key: UnlockedKey, keys: Keys): Promise<string> {
  const text = JSON.stringify(value)
  const message = await signAndEncrypt(text, key, { therapist: keys.therapist_public_key, recovery: keys.recovery_public_key })
  // Check before anything leaves the device: our key opens it and the signature holds.
  if ((await decryptAndVerify(message, key, keys.therapist_public_key)) !== text) throw new PgpError('decrypt_failed')
  return message
}

export async function signNote(prepared: SignPrepared, key: UnlockedKey, keys: Keys): Promise<SignBody> {
  checkKeys(keys, prepared.therapist_fingerprint, prepared.recovery_fingerprint)
  const [note, transcript, index, addenda] = await Promise.all([
    seal(prepared.note, key, keys),
    prepared.transcript ? seal(prepared.transcript, key, keys) : Promise.resolve(null),
    seal(prepared.index, key, keys),
    Promise.all(
      prepared.addenda.map(async (a) => ({
        version: a.version,
        message: await seal({ text: a.text, created_at: a.created_at }, key, keys),
      })),
    ),
  ])
  return {
    note,
    transcript,
    index,
    addenda,
    approved_at: prepared.approved_at,
    report_updated_at: prepared.report_updated_at,
    ...signedBy(keys),
  }
}

export async function signAddendum(
  text: string,
  key: UnlockedKey,
  keys: Keys,
): Promise<SignedBy & { message: string }> {
  return { message: await seal({ text, created_at: new Date().toISOString() }, key, keys), ...signedBy(keys) }
}

/** Decrypts one signed record and checks the therapist's signature. */
export async function openRecord<T>(message: string, key: UnlockedKey, keys: Keys): Promise<T> {
  const text = await decryptAndVerify(message, key, keys.therapist_public_key)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new PgpError('decrypt_failed')
  }
}
