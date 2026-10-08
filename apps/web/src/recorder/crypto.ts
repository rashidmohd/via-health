/**
 * Chunk encryption with WebCrypto (no library). CLAUDE.md rule 1: audio never leaves the
 * browser unencrypted.
 *
 * Chunk format: 0x01 | 12-byte IV | AES-256-GCM ciphertext+tag, AAD = "<session_id>|<seq>".
 */

const VERSION = 0x01
const IV_BYTES = 12

type Bytes = Uint8Array<ArrayBuffer>

function aad(sessionId: string, seq: number): Bytes {
  return new TextEncoder().encode(`${sessionId}|${seq}`)
}

/** A new session key. Returns the raw bytes (sent once to the server) and a
 *  non-extractable key used for encryption and kept on the device. */
export async function createSessionKey(): Promise<{ raw: Bytes; key: CryptoKey }> {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  return { raw, key: await importSessionKey(raw) }
}

export function importSessionKey(raw: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function encryptChunk(
  key: CryptoKey,
  sessionId: string,
  seq: number,
  plaintext: ArrayBuffer,
): Promise<Bytes> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(sessionId, seq) }, key, plaintext),
  )
  const out = new Uint8Array(1 + IV_BYTES + ciphertext.length)
  out[0] = VERSION
  out.set(iv, 1)
  out.set(ciphertext, 1 + IV_BYTES)
  return out
}

export async function decryptChunk(
  key: CryptoKey,
  sessionId: string,
  seq: number,
  chunk: Bytes,
): Promise<ArrayBuffer> {
  if (chunk[0] !== VERSION || chunk.length <= 1 + IV_BYTES) throw new Error('unsupported chunk')
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: chunk.slice(1, 1 + IV_BYTES), additionalData: aad(sessionId, seq) },
    key,
    chunk.slice(1 + IV_BYTES),
  )
}

export async function sha256Hex(data: Bytes): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function toBase64(bytes: Bytes): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}
