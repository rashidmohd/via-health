import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

/** Session note template `verlauf` v1 (plan 0009). Labels are UI strings: `report.fields.*`. */
export const AI_FIELDS = [
  'homework_followup',
  'current_situation',
  'topics',
  'interventions',
  'agreements',
  'next_session',
] as const
export const THERAPIST_FIELDS = ['mental_status', 'understanding', 'progress', 'crisis', 'notable'] as const
export const SESSION_TYPES = [
  'consultation',
  'probatory',
  'acute',
  'short_term',
  'long_term',
  'relapse_prevention',
  'significant_others',
  'other',
] as const
export const SETTINGS = ['individual', 'couple', 'family', 'group'] as const
export const MODES = ['in_person', 'video'] as const

export type AiField = (typeof AI_FIELDS)[number]
export type TherapistField = (typeof THERAPIST_FIELDS)[number]
export type ReportStatus = 'none' | 'pending' | 'drafting' | 'draft' | 'approved' | 'failed' | 'no_consent'
export type Support = 'supported' | 'partly' | 'unsupported'

export interface ReportHeader {
  session_type: (typeof SESSION_TYPES)[number] | null
  session_no: string | null
  setting: (typeof SETTINGS)[number]
  mode: (typeof MODES)[number]
  attendees_extra: string
  location: string
}

export interface Statement {
  id: string
  text: string
  kind: string | null
  origin: 'ai' | 'therapist'
  /** Transcript times [start_ms, end_ms] the statement is based on. */
  refs: [number, number][]
  /** Ids of confirmed note chips the statement is based on. */
  notes: string[]
  support: Support | null
  ai_wording: string[]
  wording: string[]
  /** The AI used another person's name; the note should name roles (ADR 0007). */
  third_party_name: boolean
  resolved: boolean
  blocking: boolean
}

export interface ReportContent {
  header: ReportHeader
  ai: Record<AiField, { status: 'content' | 'not_discussed'; statements: Statement[] }>
  therapist: Record<TherapistField, string>
}

export interface ReportVersion {
  version: number
  kind: 'approval' | 'addendum'
  created_at: string
  text: string | null
}

export interface Report {
  session_id: string
  status: ReportStatus
  failure_reason: string | null
  pending_field: AiField | null
  template_code: string
  template_version: number
  ai_assisted: boolean
  llm_model: string | null
  prompt_version: string | null
  content: ReportContent
  default_session_no: number
  blocking: number
  updated_at: string | null
  approved_at: string | null
  versions: ReportVersion[]
}

/** What the browser may send: text and "resolved" only; sources stay on the server. */
export function contentBody(content: ReportContent) {
  return {
    header: content.header,
    ai: Object.fromEntries(
      AI_FIELDS.map((code) => [
        code,
        {
          statements: content.ai[code].statements
            .filter((s) => s.text.trim() !== '')
            .map((s) => ({ id: s.id, text: s.text.trim(), resolved: s.resolved })),
        },
      ]),
    ),
    therapist: content.therapist,
  }
}

export function newStatementId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const BUSY: ReportStatus[] = ['pending', 'drafting']

export function useReport(sessionId: string, enabled = true) {
  return useQuery({
    queryKey: ['report', sessionId],
    queryFn: () => api<Report>(`/sessions/${sessionId}/report`),
    enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status && BUSY.includes(status)) return 3_000
      // A new transcript is drafted automatically within ~15 s of being ready.
      return status === 'none' ? 10_000 : false
    },
  })
}

function useReportMutation<T>(sessionId: string, fn: (arg: T) => Promise<Report>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (report) => {
      queryClient.setQueryData(['report', sessionId], report)
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
    },
  })
}

export function useSaveReport(sessionId: string) {
  return useReportMutation(sessionId, (content: ReportContent) =>
    api<Report>(`/sessions/${sessionId}/report`, { method: 'PUT', body: contentBody(content) }),
  )
}

export function useRequestDraft(sessionId: string) {
  return useReportMutation(sessionId, (field: AiField | null) =>
    api<Report>(`/sessions/${sessionId}/report/draft`, { method: 'POST', body: { field } }),
  )
}

export function useApproveReport(sessionId: string) {
  return useReportMutation(sessionId, () =>
    api<Report>(`/sessions/${sessionId}/report/approve`, { method: 'POST' }),
  )
}

export function useAddAddendum(sessionId: string) {
  return useReportMutation(sessionId, (text: string) =>
    api<Report>(`/sessions/${sessionId}/report/addenda`, { method: 'POST', body: { text } }),
  )
}

export function useHiddenNames(clientId: string) {
  return useQuery({
    queryKey: ['hidden-names', clientId],
    queryFn: () => api<{ names: string[] }>(`/clients/${clientId}/hidden-names`),
  })
}

export function useSaveHiddenNames(clientId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (names: string[]) =>
      api<{ names: string[] }>(`/clients/${clientId}/hidden-names`, { method: 'PUT', body: { names } }),
    onSuccess: (data) => queryClient.setQueryData(['hidden-names', clientId], data),
  })
}
