import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../api/client'
import { useSetTurnExcluded, type Transcript } from '../../api/sessions'
import { errorMessage } from '../../i18n/errors'
import { SpeakerAvatar } from '../sessions/SpeakerAvatar'
import { roleOfSpeaker, useSpeakerName } from '../sessions/speakerNames'
import { overlaps } from './overlaps'

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** Transcript next to the note. Before the draft (`onSelect` absent) the therapist reviews it
 *  and may leave lines out of the AI draft (ADR 0018). With a draft, lines a selected statement
 *  is based on are highlighted; clicking a line selects the statement that cites it. */
export function SourceTranscript({
  sessionId,
  transcript,
  clientName,
  highlight = [],
  onSelect,
}: {
  sessionId: string
  transcript: Transcript
  clientName: string
  highlight?: [number, number][]
  onSelect?: (start: number, end: number) => void
}) {
  const { t } = useTranslation()
  const therapist = transcript.therapist_speaker
  const listRef = useRef<HTMLOListElement>(null)
  const setExcluded = useSetTurnExcluded(sessionId)
  const leftOut = transcript.segments.filter((segment) => segment.excluded).length

  useEffect(() => {
    listRef.current?.querySelector('li.source-hit')?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [highlight])

  const nameOf = useSpeakerName(therapist, clientName)

  return (
    <div className="card">
      <h2>{t('transcript.title')}</h2>
      <p className="muted small">{t(onSelect ? 'report.sourceHint' : 'report.reviewHint')}</p>
      {leftOut > 0 && (
        <p className="muted small" role="status">
          {t('report.leftOutCount', { count: leftOut })}
          {onSelect && ` ${t('report.redraftHint')}`}
        </p>
      )}
      {setExcluded.error && (
        <p className="form-error" role="alert">
          {errorMessage(t, setExcluded.error instanceof ApiError ? setExcluded.error.code : 'unknown')}
        </p>
      )}
      <ol className="transcript chat source" ref={listRef} lang={transcript.language.slice(0, 2)}>
        {transcript.segments.map((segment, index) => {
          const hit = highlight.some(([a, b]) => overlaps(a, b, segment.start_ms, segment.end_ms))
          const role = roleOfSpeaker(segment.speaker, therapist)
          const time = formatTime(segment.start_ms)
          const excluded = segment.excluded === true
          const body = (
            <>
              <span className="meta">
                <span className="who">{nameOf(segment.speaker)}</span>
                <span className="time">{time}</span>
                {excluded && <span className="left-out">{t('report.leftOut')}</span>}
              </span>
              <span className="text">{segment.text}</span>
            </>
          )
          return (
            <li
              key={`${segment.start_ms}-${index}`}
              className={`${role ?? 'unknown'}${hit ? ' source-hit' : ''}${excluded ? ' excluded' : ''}`}
            >
              <SpeakerAvatar role={role} label={segment.speaker ?? '?'} clientName={clientName} size={28} />
              {onSelect ? (
                <button className="line source-line" onClick={() => onSelect(segment.start_ms, segment.end_ms)}>
                  {body}
                </button>
              ) : (
                <div className="line source-line static">{body}</div>
              )}
              <button
                className="icon-button bare exclude-button"
                disabled={setExcluded.isPending}
                title={t(excluded ? 'report.includeAgain' : 'report.leaveOut')}
                aria-label={t(excluded ? 'report.includeAgainLabel' : 'report.leaveOutLabel', { time })}
                aria-pressed={excluded}
                onClick={() =>
                  setExcluded.mutate({ start_ms: segment.start_ms, end_ms: segment.end_ms, excluded: !excluded })
                }
              >
                {excluded ? <Eye className="icon" aria-hidden="true" /> : <EyeOff className="icon" aria-hidden="true" />}
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
