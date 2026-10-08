import type { TFunction } from 'i18next'

// Must match backend/app/db/errors.py DB_ERROR_CODES.
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
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export function errorMessage(t: TFunction, code: string | null | undefined): string {
  return (ERROR_CODES as readonly string[]).includes(code ?? '')
    ? t(`errors.${code}`)
    : t('errors.unknown')
}
