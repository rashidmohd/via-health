import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { Transcript } from '../../api/sessions'
import { SpeakerAvatar } from '../sessions/SpeakerAvatar'
import { roleOfSpeaker, useSpeakerName } from '../sessions/speakerNames'
import { overlaps } from './overlaps'

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** Read-only transcript next to the note. Lines a selected statement is based on are
 *  highlighted; clicking a line selects the statement that cites it. */
export function SourceTranscript({
  transcript,
  clientName,
  highlight,
  onSelect,
}: {
  transcript: Transcript
  clientName: string
  highlight: [number, number][]
  onSelect: (start: number, end: number) => void
}) {
  const { t } = useTranslation()
  const therapist = transcript.therapist_speaker
  const listRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    listRef.current?.querySelector('li.source-hit')?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [highlight])

  const nameOf = useSpeakerName(therapist, clientName)

  return (
    <div className="card">
      <h2>{t('transcript.title')}</h2>
      <p className="muted small">{t('report.sourceHint')}</p>
      <ol className="transcript chat source" ref={listRef} lang={transcript.language.slice(0, 2)}>
        {transcript.segments.map((segment, index) => {
          const hit = highlight.some(([a, b]) => overlaps(a, b, segment.start_ms, segment.end_ms))
          const role = roleOfSpeaker(segment.speaker, therapist)
          return (
            <li key={`${segment.start_ms}-${index}`} className={`${role ?? 'unknown'}${hit ? ' source-hit' : ''}`}>
              <SpeakerAvatar role={role} label={segment.speaker ?? '?'} clientName={clientName} size={28} />
              <button className="line source-line" onClick={() => onSelect(segment.start_ms, segment.end_ms)}>
                <span className="meta">
                  <span className="who">{nameOf(segment.speaker)}</span>
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
