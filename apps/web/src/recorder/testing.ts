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
  const track = { stop: vi.fn(), onended: null as null | (() => void) }
  return { track, stream: { getAudioTracks: () => [track], getTracks: () => [track] } }
}

/** Installs a fake microphone, MediaRecorder and plenty of storage. Returns the audio track. */
export function installFakeMicrophone() {
  const fake = fakeStream()
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => fake.stream) },
  })
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { estimate: async () => ({ quota: 10e9, usage: 0 }), persist: async () => true },
  })
  return fake.track
}
