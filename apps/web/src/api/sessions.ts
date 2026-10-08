import { useQuery } from '@tanstack/react-query'
import { api } from './client'

export interface ServerSession {
  id: string
  client_id: string
  client_name: string
  started_at: string
  ended_at: string | null
  status: 'recording' | 'uploaded' | 'processing' | 'draft_ready' | 'signed' | 'failed'
  audio_state: 'present' | 'shred_pending' | 'shredded'
  duration_ms: number | null
  total_chunks: number | null
  uploaded_chunks: number
}

export function useSessions(clientId?: string) {
  return useQuery({
    queryKey: ['sessions', clientId ?? 'all'],
    queryFn: () =>
      api<ServerSession[]>(clientId ? `/sessions?client_id=${clientId}` : '/sessions'),
    refetchInterval: 15_000,
  })
}
