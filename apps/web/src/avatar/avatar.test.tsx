import { act, render } from '@testing-library/react'
import { EVENT_MS, moodFor, NOD_MS, WELCOME_MS, type AvatarInputs } from './mood'
import { RiveAvatar } from './RiveAvatar'

const base: AvatarInputs = {
  recording: false,
  online: true,
  problem: false,
  processing: false,
  sinceShownMs: 10_000,
  recent: null,
}

describe('avatar mood', () => {
  it.each<[string, Partial<AvatarInputs>, string]>([
    ['resting', {}, 'attentive'],
    ['just shown', { sinceShownMs: 100 }, 'welcome'],
    ['processing', { processing: true }, 'thinking'],
    ['offline', { online: false }, 'concern'],
    ['upload problem', { problem: true }, 'concern'],
    ['recording', { recording: true, online: false, processing: true }, 'still'],
    ['client added', { recent: { event: 'client.created', ageMs: 100 } }, 'encouraging'],
    ['uploaded', { recent: { event: 'upload.done', ageMs: 100 } }, 'pleased'],
    ['transcript ready', { recent: { event: 'transcript.ready', ageMs: 100 }, processing: true }, 'pleased'],
    ['onboarding step', { recent: { event: 'onboarding.step', ageMs: 100 } }, 'encouraging'],
    ['report signed', { recent: { event: 'report.signed', ageMs: 100 } }, 'pleased'],
    ['pleased lasts 3 s', { recent: { event: 'report.signed', ageMs: 3001 } }, 'attentive'],
    ['consent missing or error', { problem: true }, 'concern'],
    ['old event', { recent: { event: 'upload.done', ageMs: EVENT_MS + 1 } }, 'attentive'],
  ])('%s', (_label, input, mood) => {
    expect(moodFor({ ...base, ...input }).mood).toBe(mood)
  })

  it('welcome lasts 3 s', () => {
    expect(moodFor({ ...base, sinceShownMs: 2999 }).mood).toBe('welcome')
    expect(moodFor({ ...base, sinceShownMs: WELCOME_MS + 1 }).mood).toBe('attentive')
  })

  it('nods on a noted chip only when switched on', () => {
    const recent = { event: 'capture.noted' as const, ageMs: 100 }
    expect(moodFor({ ...base, recording: true, recent }).nod).toBe(false)
    expect(moodFor({ ...base, recording: true, recent, nodOnCapture: true })).toEqual({ mood: 'still', nod: true })
    expect(moodFor({ ...base, recent: { ...recent, ageMs: NOD_MS + 1 }, nodOnCapture: true }).nod).toBe(false)
  })

  it('takes no input from sessions: no transcript, text, audio or emotion in the avatar code', () => {
    const sources = import.meta.glob(['./*.ts', './*.tsx', '!./*.test.*'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(4)
    for (const [file, code] of Object.entries(sources)) {
      const imports = code.split('\n').filter((line) => line.startsWith('import'))
      expect({ file, imports: imports.filter((l) => /transcript|sessions'|live-stt|detectors|micMonitor|vad/i.test(l)) }).toEqual({
        file,
        imports: [],
      })
      expect({ file, emotionApi: /getUserMedia|AudioContext|sentiment/i.test(code) }).toEqual({ file, emotionApi: false })
    }
  })

  it('is decorative and renders each mood', async () => {
    for (const mood of ['welcome', 'attentive', 'thinking', 'encouraging', 'pleased', 'concern', 'still'] as const) {
      const { container, unmount } = render(<RiveAvatar mood={mood} />)
      await act(async () => {})
      const image = container.firstElementChild!
      expect(image).toHaveAttribute('aria-hidden', 'true')
      expect(image).toHaveAttribute('data-mood', mood)
      unmount()
    }
  })
})
