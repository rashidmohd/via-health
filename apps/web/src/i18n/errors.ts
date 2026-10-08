import type { TFunction } from 'i18next'

// Must cover backend/app/db/errors.py DB_ERROR_CODES and the API error codes.
export const ERROR_CODES = [
  'client_not_found',
  'client_not_active',
  'consent_missing',
  'consent_text_kind_mismatch',
  'consent_invalid',
  'consent_immutable',
  'session_not_found',
  'audio_not_accepted',
  'chunk_conflict',
  'consent_texts_immutable',
  'audit_log_immutable',
  'not_authenticated',
  'code_invalid',
  'too_many_requests',
  'email_failed',
  'invalid_input',
  'origin_not_allowed',
  'network_error',
  'consent_already_given',
  'consent_text_missing',
  'consent_not_found',
  'session_conflict',
  'key_conflict',
  'key_missing',
  'chunk_too_large',
  'checksum_mismatch',
  'chunk_out_of_range',
  'transcript_not_ready',
  'session_not_failed',
  'key_service_unavailable',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export function errorMessage(t: TFunction, code: string | null | undefined): string {
  return (ERROR_CODES as readonly string[]).includes(code ?? '')
    ? t(`errors.${code}`)
    : t('errors.unknown')
}
