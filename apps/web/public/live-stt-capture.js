/*
 * AudioWorklet: copies microphone samples to the live preview worker in ~85 ms blocks.
 * Read-only tap on the stream; the recorder uses the same stream independently.
 */
class LiveSttCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.out = null
    this.block = new Float32Array(4096)
    this.filled = 0
    this.port.onmessage = (event) => {
      if (event.data && event.data.port) this.out = event.data.port
    }
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel && this.out) {
      let offset = 0
      while (offset < channel.length) {
        const n = Math.min(channel.length - offset, this.block.length - this.filled)
        this.block.set(channel.subarray(offset, offset + n), this.filled)
        this.filled += n
        offset += n
        if (this.filled === this.block.length) {
          const samples = this.block
          this.out.postMessage({ samples, sampleRate }, [samples.buffer])
          this.block = new Float32Array(4096)
          this.filled = 0
        }
      }
    }
    return true
  }
}

registerProcessor('live-stt-capture', LiveSttCapture)
