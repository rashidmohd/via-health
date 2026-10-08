/** Merge server text (better, with speakers, ~1 min behind) with the device's live text. */

export interface ServerSegment {
  speaker: string | null
  start_ms: number
  end_ms: number
  text: string
}

export interface LocalLine {
  text: string
  startMs: number
  endMs: number
}

export interface MergedLine {
  source: 'server' | 'device' | 'partial'
  speaker: string | null
  startMs: number
  text: string
}

/** Device lines that start inside the server-covered time are dropped (server text wins). */
export function mergeLive(
  server: readonly ServerSegment[],
  coveredMs: number,
  local: readonly LocalLine[],
  partial: { text: string; startMs: number } | null,
): MergedLine[] {
  const lines: MergedLine[] = server.map((s) => ({
    source: 'server',
    speaker: s.speaker,
    startMs: s.start_ms,
    text: s.text,
  }))
  for (const line of local) {
    if (line.startMs >= coveredMs) {
      lines.push({ source: 'device', speaker: null, startMs: line.startMs, text: line.text })
    }
  }
  if (partial && partial.text && partial.startMs >= coveredMs) {
    lines.push({ source: 'partial', speaker: null, startMs: partial.startMs, text: partial.text })
  }
  return lines
}
