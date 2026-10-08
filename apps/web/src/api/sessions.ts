import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export type SessionStatus =
  | 'recording'
  | 'uploaded'
  | 'processing'
  | 'transcribed'
  | 'draft_ready'
  | 'signed'
  | 'failed'

export interface ServerSession {
  id: string
  client_id: string
  client_name: string
  started_at: string
  ended_at: string | null
  status: SessionStatus
  audio_state: 'present' | 'shred_pending' | 'shredded'
  duration_ms: number | null
  total_chunks: number | null
  uploaded_chunks: number
  failure_reason: string | null
}

export interface TranscriptSegment {
  speaker: string | null
  start_ms: number
  end_ms: number
  text: string
}

export interface Transcript {
  session_id: string
  language: string
  stt_model: string
  therapist_speaker: string | null
  segments: TranscriptSegment[]
}

const IN_PROGRESS: SessionStatus[] = ['recording', 'uploaded', 'processing']

export function useSessions(clientId?: string) {
  return useQuery({
    queryKey: ['sessions', clientId ?? 'all'],
    queryFn: () =>
      api<ServerSession[]>(clientId ? `/sessions?client_id=${clientId}` : '/sessions'),
    refetchInterval: 15_000,
  })
}

export function useSession(id: string) {
  return useQuery({
    queryKey: ['session', id],
    queryFn: () => api<ServerSession>(`/sessions/${id}`),
    // Poll while the worker is busy; stop once there is a result.
    refetchInterval: (query) =>
      query.state.data && IN_PROGRESS.includes(query.state.data.status) ? 5_000 : false,
  })
}

export function useTranscript(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ['transcript', id],
    queryFn: () => api<Transcript>(`/sessions/${id}/transcript`),
    enabled,
  })
}

export function useSetTherapistSpeaker(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (speaker: string) =>
      api<Transcript>(`/sessions/${id}/transcript`, {
        method: 'PATCH',
        body: { therapist_speaker: speaker },
      }),
    onSuccess: (transcript) => queryClient.setQueryData(['transcript', id], transcript),
  })
}

export function useRetrySession(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<ServerSession>(`/sessions/${id}/retry`, { method: 'POST' }),
    onSuccess: (session) => queryClient.setQueryData(['session', id], session),
  })
}
