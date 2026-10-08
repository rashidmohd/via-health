import type { TFunction } from 'i18next'
import type { ServerSession } from '../../api/sessions'

/** One status per session: the note's status once the transcript is there. */
export function sessionStatus(t: TFunction, s: ServerSession): { label: string; tone: 'info' | 'attention' | 'neutral' } {
  if (s.status === 'transcribed' && s.report_status) {
    const tone = s.report_status === 'draft' || s.report_status === 'failed' ? 'attention' : 'neutral'
    return { label: t(`report.status.${s.report_status}`), tone }
  }
  const tone = s.status === 'failed' ? 'attention' : s.status === 'processing' || s.status === 'uploaded' ? 'info' : 'neutral'
  return { label: t(`sessions.status.${s.status}`), tone }
}

export type SessionFilter = 'all' | 'toReview' | 'inProgress'

export function matchesFilter(s: ServerSession, filter: SessionFilter): boolean {
  if (filter === 'toReview') return s.report_status === 'draft'
  if (filter === 'inProgress') return ['recording', 'uploaded', 'processing'].includes(s.status)
  return true
}
