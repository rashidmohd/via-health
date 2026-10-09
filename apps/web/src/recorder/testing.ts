/** Test doubles for the microphone and MediaRecorder (jsdom has neither). */

export class FakeMediaRecorder extends EventTarget {
  static last: FakeMediaRecorder | null = null
  static isTypeSupported = (type: string) => type === 'audio/webm;codecs=opus'
  state: 'inactive' | 'recording' = 'inactive'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  timeslice = 0
  readonly options: MediaRecorderOptions

  constructor(_stream: MediaStream, options: MediaRecorderOptions) {
    super()
    this.options = options
    FakeMediaRecorder.last = this
  }

  start(timeslice: number) {
    this.state = 'recording'
    this.timeslice = timeslice
  }

  emit(text: string) {
    this.ondataavailable?.({ data: new Blob([text]) })
  }

  stop() {
    this.state = 'inactive'
    this.emit('final slice')
    this.dispatchEvent(new Event('stop'))
  }
}

function fakeStream() {
  const track = {
    stop: vi.fn(),
    onended: null as null | (() => void),
    readyState: 'live' as 'live' | 'ended',
  }
  return { track, stream: { getAudioTracks: () => [track], getTracks: () => [track] } }
}

export type FakeTrack = ReturnType<typeof fakeStream>['track']

/** Every audio track handed out by the fake `getUserMedia`, in order (reconnects add more). */
export const fakeTracks: FakeTrack[] = []

/** Installs a fake microphone, MediaRecorder and plenty of storage. Returns the first audio
 *  track; later `getUserMedia` calls (reconnects) get fresh streams. `navigator.mediaDevices`
 *  is an EventTarget, so tests can dispatch `devicechange`. */
export function installFakeMicrophone() {
  const first = fakeStream()
  fakeTracks.length = 0
  fakeTracks.push(first.track)
  let calls = 0
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  const devices = Object.assign(new EventTarget(), {
    getUserMedia: vi.fn(async () => {
      if (calls++ === 0) return first.stream
      const next = fakeStream()
      fakeTracks.push(next.track)
      return next.stream
    }),
  })
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: devices })
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { estimate: async () => ({ quota: 10e9, usage: 0 }), persist: async () => true },
  })
  return first.track
}
