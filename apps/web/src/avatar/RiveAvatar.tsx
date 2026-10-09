import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { PRESETS, type Appearance } from './appearance'
import { DrawnFace } from './DrawnFace'
import type { Mood } from './mood'
import { loadRiveFile } from './rive'

const RiveCanvas = lazy(() => import('./RiveCanvas'))

/** Placeholder if the code-split Rive chunk can't load (e.g. offline before it was cached). */
class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/**
 * The illustrated character (plan 0011). Reacts only to app state (`mood` from `useAvatarMood`).
 * Until the designer's .riv exists, or if it fails to load, the SVG stand-in draws the same
 * appearance with the same props — callers never care which one they get. Decorative: `aria-hidden`.
 */
export function RiveAvatar({
  mood,
  appearance = PRESETS[0],
  recording = false,
  nod = false,
  size = 160,
}: {
  mood: Mood
  appearance?: Appearance
  recording?: boolean
  nod?: boolean
  size?: number
}) {
  const [file, setFile] = useState<ArrayBuffer | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void loadRiveFile().then((bytes) => {
      // Each character gets its own copy: the runtime may take ownership of the buffer.
      if (!cancelled && bytes) setFile(bytes.slice(0))
    })
    return () => {
      cancelled = true
    }
  }, [])

  const placeholder = (
    <DrawnFace appearance={appearance} mood={mood} size={size} nod={nod} recording={recording} />
  )
  if (!file || failed) return placeholder

  return (
    <Fallback fallback={placeholder}>
      <Suspense fallback={placeholder}>
        <RiveCanvas
          file={file}
          mood={mood}
          appearance={appearance}
          recording={recording}
          nod={nod}
          size={size}
          onError={() => setFailed(true)}
        />
      </Suspense>
    </Fallback>
  )
}
