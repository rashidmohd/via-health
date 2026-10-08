import { createSessionKey, decryptChunk, encryptChunk, sha256Hex } from './crypto'
import { uuidv7 } from './uuidv7'

const audio = new TextEncoder().encode('opus audio bytes').buffer as ArrayBuffer

describe('chunk encryption', () => {
  it('round trips and hides the plaintext', async () => {
    const { key } = await createSessionKey()
    const chunk = await encryptChunk(key, 's1', 0, audio)
    expect(chunk[0]).toBe(1)
    expect(new TextDecoder().decode(chunk)).not.toContain('opus audio')
    expect(new TextDecoder().decode(await decryptChunk(key, 's1', 0, chunk))).toBe('opus audio bytes')
  })

  it('fresh IV per chunk', async () => {
    const { key } = await createSessionKey()
    const a = await encryptChunk(key, 's1', 0, audio)
    const b = await encryptChunk(key, 's1', 0, audio)
    expect(await sha256Hex(a)).not.toBe(await sha256Hex(b))
  })

  it.each([
    ['other sequence number', 's1', 1],
    ['other session', 's2', 0],
  ])('fails for %s (AAD)', async (_label, session, seq) => {
    const { key } = await createSessionKey()
    const chunk = await encryptChunk(key, 's1', 0, audio)
    await expect(decryptChunk(key, session, seq, chunk)).rejects.toThrow()
  })

  it('fails with the wrong key or tampered data', async () => {
    const { key } = await createSessionKey()
    const { key: other } = await createSessionKey()
    const chunk = await encryptChunk(key, 's1', 0, audio)
    await expect(decryptChunk(other, 's1', 0, chunk)).rejects.toThrow()
    const tampered = chunk.slice()
    tampered[tampered.length - 1] ^= 1
    await expect(decryptChunk(key, 's1', 0, tampered)).rejects.toThrow()
  })

  it('keeps the key non-extractable', async () => {
    const { key, raw } = await createSessionKey()
    expect(key.extractable).toBe(false)
    expect(raw).toHaveLength(32)
  })
})

describe('uuidv7', () => {
  it('has version 7 and sorts by time', () => {
    const a = uuidv7(1_700_000_000_000)
    const b = uuidv7(1_700_000_000_001)
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(a < b).toBe(true)
  })
})
