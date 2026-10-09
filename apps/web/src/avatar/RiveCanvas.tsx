import riveWasm from '@rive-app/canvas/rive.wasm?url'
import riveFallbackWasm from '@rive-app/canvas/rive_fallback.wasm?url'
import { RuntimeLoader, useRive, useStateMachineInput, type StateMachineInput } from '@rive-app/react-canvas'
import { useEffect, useRef } from 'react'
import type { Mood } from './mood'
import { ARTBOARD, EMOTION, INPUT, PAUSE_AFTER_MS, STATE_MACHINE, type Character } from './rive'

// The runtime is served from our own origin. By default Rive loads it from unpkg / jsdelivr
// (non-EU third parties, CLAUDE.md rule 4).
RuntimeLoader.setWasmUrl(riveWasm)
RuntimeLoader.setWasmFallbackUrl(riveFallbackWasm)

/** Rive inputs are imperative objects owned by the runtime, not React state. */
function setInput(input: StateMachineInput | null, value: number | boolean): void {
  if (input) input.value = value
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** The Rive character. Loaded lazily (code-split) and only when the .riv file exists. */
export default function RiveCanvas({
  file,
  mood,
  character,
  recording,
  nod,
  size,
  onError,
}: {
  file: ArrayBuffer
  mood: Mood
  character: Character
  recording: boolean
  nod: boolean
  size: number
  onError: () => void
}) {
  const { rive, RiveComponent } = useRive({
    buffer: file,
    artboard: ARTBOARD,
    stateMachines: STATE_MACHINE,
    autoplay: true,
    onLoadError: onError,
  })
  const lookX = useStateMachineInput(rive, STATE_MACHINE, INPUT.lookX)
  const lookY = useStateMachineInput(rive, STATE_MACHINE, INPUT.lookY)
  const emotion = useStateMachineInput(rive, STATE_MACHINE, INPUT.emotion)
  const still = useStateMachineInput(rive, STATE_MACHINE, INPUT.recording)
  const noted = useStateMachineInput(rive, STATE_MACHINE, INPUT.noted)
  const look = useStateMachineInput(rive, STATE_MACHINE, INPUT.character)

  useEffect(() => {
    setInput(emotion, EMOTION[mood])
  }, [emotion, mood])

  useEffect(() => {
    setInput(look, character)
  }, [look, character])

  const repause = useRef(0)
  useEffect(() => {
    setInput(still, recording)
    clearTimeout(repause.current)
    if (!rive) return
    if (!recording) {
      rive.play()
      return
    }
    // Settle into the still pose, then stop rendering to free CPU for audio, crypto and WASM STT.
    const timer = setTimeout(() => rive.pause(), PAUSE_AFTER_MS)
    return () => clearTimeout(timer)
  }, [still, recording, rive])

  // `noted`: a short glance for a confirmed capture chip (only when the therapist enabled it).
  const nodded = useRef(false)
  useEffect(() => {
    if (!nod) {
      nodded.current = false
      return
    }
    if (nodded.current || !noted) return
    nodded.current = true
    noted.fire()
    if (recording && rive) {
      // Paused while recording: render the glance, then pause again.
      rive.play()
      clearTimeout(repause.current)
      repause.current = window.setTimeout(() => rive.pause(), 1000 + PAUSE_AFTER_MS)
    }
  }, [nod, noted, recording, rive])
  useEffect(() => () => clearTimeout(repause.current), [])

  useEffect(() => {
    if (recording || prefersReducedMotion() || !lookX || !lookY) return
    let frame = 0
    const onMove = (event: PointerEvent) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        setInput(lookX, (event.clientX / window.innerWidth) * 200 - 100)
        setInput(lookY, (event.clientY / window.innerHeight) * 200 - 100)
      })
    }
    window.addEventListener('pointermove', onMove)
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(frame)
    }
  }, [lookX, lookY, recording])

  return <RiveComponent aria-hidden="true" className="avatar-rive" style={{ width: size, height: size }} />
}
