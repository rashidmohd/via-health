import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { unlockedKey } from '../crypto/keyring'
import { PgpError } from '../crypto/pgp'
import { signAddendum, signNote, type SignPrepared } from '../crypto/records'
import { api } from './client'
import type { Keys } from './keys'

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
export type ReportStatus =
  | 'none'
  | 'pending'
  | 'drafting'
  | 'draft'
  /** Approved before signing existed (test data); can be signed later. */
  | 'approved'
  | 'signed'
  | 'failed'
  | 'no_consent'
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
  /** Addendum of an approved, not yet signed note. */
  text: string | null
  /** Signed addendum: OpenPGP message, opened in the browser. */
  message: string | null
}

/** A signed note as the server stores it: messages only the therapist's key opens. */
export interface SignedRecord {
  note: string
  transcript: string | null
  index: string
  signer_fingerprint: string
  encrypted_to: string[]
  signed_at: string
}

/** Decrypted `SignedRecord.note` (backend `_note_record`). */
export interface NoteRecord {
  session: { id: string; client_id: string; client_name: string; started_at: string }
  content: ReportContent
  ai_assisted: boolean
  approved_at: string
}

/** Decrypted `SignedRecord.index`: what the Reports page shows. */
export interface NoteIndex {
  session_no: string | null
  session_type: ReportHeader['session_type']
  topics: string[]
}

/** Decrypted signed addendum. */
export interface AddendumRecord {
  text: string
  created_at: string
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
  signed: SignedRecord | null
}

/** A row on the Reports page: approved and signed notes (plans 0013, 0014). For a signed note
 *  number, type and topics are only in the encrypted `index`. */
export interface ApprovedReport {
  session_id: string
  client_id: string
  client_name: string
  started_at: string
  approved_at: string
  signed: boolean
  index: string | null
  session_no: string | null
  session_type: ReportHeader['session_type']
  topics: string[]
  addenda: number
}

export function useApprovedReports() {
  return useQuery({
    queryKey: ['reports'],
    queryFn: () => api<ApprovedReport[]>('/reports'),
  })
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
      void queryClient.invalidateQueries({ queryKey: ['reports'] })
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

function requireUnlocked() {
  const key = unlockedKey()
  if (!key) throw new PgpError('key_locked')
  return key
}

/** "Approve and sign" (plan 0014): the server checks the note and returns the record, the
 *  browser signs and encrypts it, the server stores it and drops its readable copies. The key
 *  must be unlocked first. */
export function useSignReport(sessionId: string) {
  const queryClient = useQueryClient()
  return useReportMutation(sessionId, async (keys: Keys) => {
    const key = requireUnlocked()
    const prepared = await api<SignPrepared>(`/sessions/${sessionId}/report/sign/prepare`, { method: 'POST' })
    const body = await signNote(prepared, key, keys)
    const report = await api<Report>(`/sessions/${sessionId}/report/sign`, { method: 'POST', body })
    // The transcript now exists only in the signed record.
    queryClient.removeQueries({ queryKey: ['transcript', sessionId] })
    void queryClient.invalidateQueries({ queryKey: ['session', sessionId] })
    return report
  })
}

export function useAddAddendum(sessionId: string) {
  return useReportMutation(sessionId, async ({ text, keys }: { text: string; keys: Keys }) => {
    const body = await signAddendum(text, requireUnlocked(), keys)
    return api<Report>(`/sessions/${sessionId}/report/addenda`, { method: 'POST', body })
  })
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
