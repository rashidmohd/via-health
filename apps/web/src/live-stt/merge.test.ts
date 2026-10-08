import buildScript from '../../scripts/build-live-stt.mjs?raw'
import { mergeLive } from './merge'
import { LIVE_STT_VERSION } from './version'

describe('mergeLive', () => {
  const server = [{ speaker: '1', start_ms: 1000, end_ms: 4000, text: 'Guten Tag.' }]

  it('shows device text after the server-covered time, and the partial last', () => {
    const lines = mergeLive(
      server,
      48_000,
      [
        { text: 'alte vorschau', startMs: 2000, endMs: 3000 }, // covered by the server: dropped
        { text: 'neu vom gerät', startMs: 50_000, endMs: 53_000 },
      ],
      { text: 'gerade gesprochen', startMs: 54_000 },
    )
    expect(lines.map((l) => [l.source, l.text])).toEqual([
      ['server', 'Guten Tag.'],
      ['device', 'neu vom gerät'],
      ['partial', 'gerade gesprochen'],
    ])
  })

  it('without server text shows everything from the device', () => {
    expect(mergeLive([], 0, [{ text: 'a', startMs: 0, endMs: 1 }], null)).toHaveLength(1)
  })
})

describe('live-stt build', () => {
  it('app and build script use the same model version', () => {
    expect(buildScript).toContain(`export const VERSION = '${LIVE_STT_VERSION}'`)
  })

  it('pins downloads by checksum', () => {
    expect(buildScript.match(/sha256/g)?.length).toBeGreaterThanOrEqual(6)
  })
})
