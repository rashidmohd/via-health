import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export type NotificationKind =
  | 'transcript_ready'
  | 'transcription_failed'
  | 'report_ready'
  | 'report_failed'
  | 'report_no_consent'

export interface AppNotification {
  id: string
  kind: NotificationKind
  session_id: string
  client_name: string
  created_at: string
  read: boolean
}

export interface Notifications {
  items: AppNotification[]
  unread: number
  /** Drafts waiting for review. */
  notes_to_review: number
}

const KEY = ['notifications'] as const

/** Polled every 30 s (plan 0010); the sidebar badge and the tab share this query. */
export function useNotifications() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api<Notifications>('/notifications'),
    refetchInterval: 30_000,
  })
}

export function useMarkRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { ids: string[] } | { all: true }) =>
      api<void>('/notifications/read', { method: 'POST', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  })
}

/** Where a notification leads: the note for note events, otherwise the session. */
export function notificationPath(n: AppNotification): string {
  return n.kind.startsWith('report_') ? `/sessions/${n.session_id}/report` : `/sessions/${n.session_id}`
}
