import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { Transcript } from '../../api/sessions'
import { overlaps } from './overlaps'

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** Read-only transcript next to the note. Lines a selected statement is based on are
 *  highlighted; clicking a line selects the statement that cites it. */
export function SourceTranscript({
  transcript,
  highlight,
  onSelect,
}: {
  transcript: Transcript
  highlight: [number, number][]
  onSelect: (start: number, end: number) => void
}) {
  const { t } = useTranslation()
  const therapist = transcript.therapist_speaker
  const listRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    listRef.current?.querySelector('li.source-hit')?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [highlight])

  function role(label: string | null): string {
    if (therapist === null) return t('transcript.speaker', { label: label ?? '?' })
    return label === therapist ? t('transcript.therapist') : t('transcript.client')
  }

  return (
    <div className="card">
      <h2>{t('transcript.title')}</h2>
      <p className="muted small">{t('report.sourceHint')}</p>
      <ol className="transcript source" ref={listRef} lang={transcript.language.slice(0, 2)}>
        {transcript.segments.map((segment, index) => {
          const hit = highlight.some(([a, b]) => overlaps(a, b, segment.start_ms, segment.end_ms))
          return (
            <li
              key={`${segment.start_ms}-${index}`}
              className={`${segment.speaker === therapist ? 'therapist' : 'client'}${hit ? ' source-hit' : ''}`}
            >
              <button className="source-line" onClick={() => onSelect(segment.start_ms, segment.end_ms)}>
                <span className="meta">
                  <span className="who">{role(segment.speaker)}</span>
                  <span className="time">{formatTime(segment.start_ms)}</span>
                </span>
                <span>{segment.text}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
