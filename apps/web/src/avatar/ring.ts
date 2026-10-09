export type RingState = 'idle' | 'silent' | 'listening' | 'processing'
export type RingBadge = 'done' | 'offline'

export function ringState({
  recording,
  voiceActive,
  processing = false,
}: {
  recording: boolean
  voiceActive: boolean
  processing?: boolean
}): RingState {
  if (recording) return voiceActive ? 'listening' : 'silent'
  return processing ? 'processing' : 'idle'
}
