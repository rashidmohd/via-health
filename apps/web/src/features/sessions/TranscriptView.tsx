import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useCorrectSpeakers,
  useSetTherapistSpeaker,
  useUndoSpeakerCorrection,
  type Transcript,
} from '../../api/sessions'

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = String(total % 60).padStart(2, '0')
  return `${m}:${s}`
}

/** Speakers ordered by how much they said; the model's labels vary ("0", "1", "2"…). */
function speakers(transcript: Transcript): { label: string; sample: string }[] {
  const words = new Map<string, number>()
  const samples = new Map<string, string>()
  for (const segment of transcript.segments) {
    const label = segment.speaker ?? '?'
    words.set(label, (words.get(label) ?? 0) + segment.text.split(/\s+/).length)
    if (!samples.has(label)) samples.set(label, segment.text)
  }
  return [...words.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label]) => ({ label, sample: samples.get(label) ?? '' }))
}

export function TranscriptView({ sessionId, transcript }: { sessionId: string; transcript: Transcript }) {
  const { t } = useTranslation()
  const setTherapist = useSetTherapistSpeaker(sessionId)
  const correct = useCorrectSpeakers(sessionId)
  const undo = useUndoSpeakerCorrection(sessionId)
  const [choosing, setChoosing] = useState(false)
  const therapist = transcript.therapist_speaker
  const askWho = therapist === null || choosing
  // The client's label: the most-speaking label that is not the therapist (2 speakers usual).
  const client = speakers(transcript).find((s) => s.label !== therapist)?.label ?? null
  const canCorrect = therapist !== null && client !== null && !choosing
  const busy = correct.isPending || undo.isPending
  const checking = transcript.refine_status === 'pending' || transcript.refine_status === 'running'

  function roleOf(label: string | null): string {
    if (therapist === null) return t('transcript.speaker', { label: label ?? '?' })
    return label === therapist ? t('transcript.therapist') : t('transcript.client')
  }

  return (
    <div className="stack">
      {askWho && (
        <div className="card who-card">
          <h2>{t('transcript.whoTitle')}</h2>
          <p className="muted">{t('transcript.whoHint')}</p>
          <ul className="who-list">
            {speakers(transcript).map(({ label, sample }) => (
              <li key={label}>
                <div>
                  <strong>{t('transcript.speaker', { label })}</strong>
                  <p className="muted small">„{sample}“</p>
                </div>
                <button
                  className="secondary"
                  disabled={setTherapist.isPending}
                  onClick={() =>
                    setTherapist.mutate(label, { onSuccess: () => setChoosing(false) })
                  }
                >
                  {t('transcript.thatsMe')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <div className="row spread">
          <h2>{t('transcript.title')}</h2>
          {therapist !== null && !choosing && (
            <button className="link" onClick={() => setChoosing(true)}>
              {t('transcript.changeSpeaker')}
            </button>
          )}
        </div>
        {checking && (
          <p className="banner info-banner" role="status">
            {t('transcript.checking')}
          </p>
        )}
        {transcript.refine_status === 'done' && <p className="muted small">{t('transcript.checked')}</p>}
        {canCorrect && (
          <div className="row spread">
            <p className="muted small">{t('transcript.correctHint')}</p>
            {transcript.corrections > 0 && (
              <button className="link small" onClick={() => undo.mutate()} disabled={busy}>
                {t('transcript.undo')}
              </button>
            )}
          </div>
        )}
        <ol className="transcript" lang={transcript.language.slice(0, 2)}>
          {transcript.segments.map((segment, index) => {
            const isTherapist = therapist !== null && segment.speaker === therapist
            const other = isTherapist ? client : therapist
            return (
              <li key={`${segment.start_ms}-${index}`} className={isTherapist ? 'therapist' : 'client'}>
                <span className="meta">
                  {canCorrect && other ? (
                    <button
                      className="who who-button"
                      disabled={busy}
                      title={t('transcript.switchTo', { role: roleOf(other) })}
                      aria-label={t('transcript.switchLabel', {
                        role: roleOf(segment.speaker),
                        time: formatTime(segment.start_ms),
                        other: roleOf(other),
                      })}
                      onClick={() =>
                        correct.mutate({ op: 'set', at_ms: segment.start_ms, speaker: other })
                      }
                    >
                      {roleOf(segment.speaker)} ⇄
                    </button>
                  ) : (
                    <span className="who">{roleOf(segment.speaker)}</span>
                  )}
                  <span className="time">{formatTime(segment.start_ms)}</span>
                  {canCorrect && index > 0 && (
                    <button
                      className="link small swap-from"
                      disabled={busy}
                      aria-label={t('transcript.swapFromLabel', { time: formatTime(segment.start_ms) })}
                      onClick={() =>
                        correct.mutate({
                          op: 'swap_from',
                          at_ms: segment.start_ms,
                          a: therapist as string,
                          b: client as string,
                        })
                      }
                    >
                      {t('transcript.swapFrom')}
                    </button>
                  )}
                </span>
                <p>{segment.text}</p>
              </li>
            )
          })}
        </ol>
        <p className="muted small">{t('transcript.reviewNote')}</p>
      </div>
    </div>
  )
}
