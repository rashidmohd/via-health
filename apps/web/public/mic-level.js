/*
 * AudioWorklet: microphone loudness (RMS) every ~50 ms, for voice activity and mic health
 * (plan 0011). Read-only tap on the recording stream. Posts numbers only — never samples.
 */
class MicLevel extends AudioWorkletProcessor {
  constructor() {
    super()
    this.size = Math.round(sampleRate * 0.05)
    this.sum = 0
    this.count = 0
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.sum += channel[i] * channel[i]
        this.count++
        if (this.count >= this.size) {
          this.port.postMessage(Math.sqrt(this.sum / this.count))
          this.sum = 0
          this.count = 0
        }
      }
    }
    return true
  }
}

registerProcessor('mic-level', MicLevel)
