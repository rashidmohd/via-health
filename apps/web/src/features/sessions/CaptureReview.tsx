import { useTranslation } from 'react-i18next'
import { useCaptures, useSaveCapture, type Transcript } from '../../api/sessions'
import { detectCaptures, type DetectedCapture } from '../../live-stt/detectors'
import { formatClock } from '../format'

interface Item extends DetectedCapture {
  status: 'suggested' | 'confirmed' | 'dismissed'
}

/** The sentence spoken around a bookmark, so the therapist knows what it was about. */
function contextAt(transcript: Transcript, atMs: number): string {
  const segment = [...transcript.segments].reverse().find((s) => s.start_ms <= atMs)
  return segment?.text.slice(0, 160) ?? ''
}

/** After the session: suggested chips (from the final transcript and bookmarks) to keep or remove. */
export function CaptureReview({ sessionId, transcript }: { sessionId: string; transcript: Transcript }) {
  const { t } = useTranslation()
  const { data: stored } = useCaptures(sessionId)
  const save = useSaveCapture(sessionId)
  if (!stored) return null

  const byKey = new Map(stored.map((c) => [c.key, c]))
  const detected = detectCaptures(transcript.segments).filter((c) => !byKey.has(c.key))
  const items: Item[] = [
    ...stored.map((c) => ({
      kind: c.kind,
      key: c.key,
      atMs: c.at_ms,
      text: c.kind === 'bookmark' && !c.text ? contextAt(transcript, c.at_ms) : c.text,
      status: c.status,
    })),
    ...detected.map((c) => ({ ...c, status: 'suggested' as const })),
  ].sort((a, b) => a.atMs - b.atMs)

  if (items.length === 0) return null

  function decide(item: Item, status: 'confirmed' | 'dismissed') {
    const existing = byKey.get(item.key)
    save.mutate({ id: existing?.id, kind: item.kind, key: item.key, at_ms: item.atMs, text: item.text, status })
  }

  return (
    <div className="card">
      <h2>{t('captures.title')}</h2>
      <p className="muted small">{t('captures.hint')}</p>
      <ul className="capture-review">
        {items.map((item) => (
          <li key={item.key} className={`status-${item.status}`}>
            <div>
              <span className={`chip chip-${item.kind}`}>
                <span className="chip-kind">{t(`captures.kind.${item.kind}`)}</span>
                <span className="time">{formatClock(item.atMs)}</span>
              </span>
              <p>{item.text}</p>
            </div>
            {item.status === 'suggested' ? (
              <div className="actions">
                <button className="secondary" onClick={() => decide(item, 'confirmed')} disabled={save.isPending}>
                  {t('captures.keep')}
                </button>
                <button className="link" onClick={() => decide(item, 'dismissed')} disabled={save.isPending}>
                  {t('captures.remove')}
                </button>
              </div>
            ) : (
              <span className="muted small">{t(`captures.status.${item.status}`)}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
