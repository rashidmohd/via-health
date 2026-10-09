import { keepRunning } from './audioContext'

class FakeContext extends EventTarget {
  state: string = 'suspended'
  resume = vi.fn(async () => {
    this.state = 'running'
  })
}

describe('keepRunning (Safari suspends contexts created after getUserMedia)', () => {
  it('resumes a suspended context right away', () => {
    const context = new FakeContext()
    keepRunning(context as unknown as AudioContext)
    expect(context.resume).toHaveBeenCalledTimes(1)
  })

  it('resumes again after an interruption and on the next tap', () => {
    const context = new FakeContext()
    context.state = 'running'
    const release = keepRunning(context as unknown as AudioContext)
    expect(context.resume).not.toHaveBeenCalled()

    context.state = 'interrupted'
    context.dispatchEvent(new Event('statechange'))
    expect(context.resume).toHaveBeenCalledTimes(1)

    context.state = 'suspended'
    window.dispatchEvent(new Event('pointerdown'))
    expect(context.resume).toHaveBeenCalledTimes(2)

    release()
    context.state = 'suspended'
    window.dispatchEvent(new Event('pointerdown'))
    context.dispatchEvent(new Event('statechange'))
    expect(context.resume).toHaveBeenCalledTimes(2)
  })

  it('leaves a closed context alone', () => {
    const context = new FakeContext()
    context.state = 'closed'
    keepRunning(context as unknown as AudioContext)
    expect(context.resume).not.toHaveBeenCalled()
  })
})
