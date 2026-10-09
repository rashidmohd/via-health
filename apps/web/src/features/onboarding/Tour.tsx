import { X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { endTour, useTourOpen } from './onboarding'

/** Each step points at an element with `data-tour="<target>"`; text lives in i18n `tour.steps.<target>`. */
const TOUR_STEPS = [
  'start',
  'nav-clients',
  'nav-sessions',
  'nav-reports',
  'nav-notifications',
  'nav-keys',
  'nav-settings',
  'sync',
] as const

type Rect = { top: number; left: number; width: number; height: number }

const PAD = 6
const CARD_WIDTH = 320

/** The first visible element for a step, or null (e.g. sidebar hidden on small screens → card centred). */
function findTarget(target: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)) {
    const rect = element.getBoundingClientRect()
    const visible =
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right > 0 &&
      rect.left < window.innerWidth &&
      getComputedStyle(element).visibility !== 'hidden'
    if (visible) return element
  }
  return null
}

/**
 * A short guided tour of the app shell. Never runs on the recording screen (ADR 0015/0020:
 * nothing may pull attention from recording).
 */
export function Tour() {
  const open = useTourOpen()
  const { pathname } = useLocation()
  if (!open || pathname.startsWith('/sessions/record')) return null
  return <TourSteps />
}

function TourSteps() {
  const { t } = useTranslation()
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const step = TOUR_STEPS[index]
  const last = index === TOUR_STEPS.length - 1

  const measure = useCallback(() => {
    const element = findTarget(step)
    if (!element) return setRect(null)
    element.scrollIntoView({ block: 'nearest' })
    const r = element.getBoundingClientRect()
    setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 })
  }, [step])

  // Measure after layout, and again whenever the page moves under the highlight.
  useEffect(() => {
    const frame = requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [measure])

  useEffect(() => {
    cardRef.current?.focus()
  }, [index])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') endTour()
      if (event.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, TOUR_STEPS.length - 1))
      if (event.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Card beside the highlight (right of the sidebar), else centred.
  let cardStyle: CSSProperties | undefined
  if (rect) {
    const roomRight = window.innerWidth - (rect.left + rect.width) - 16 >= CARD_WIDTH
    const top = Math.max(16, Math.min(rect.top, window.innerHeight - 260))
    cardStyle = roomRight
      ? { top, left: rect.left + rect.width + 16 }
      : { top: Math.min(rect.top + rect.height + 12, window.innerHeight - 260), left: 16 }
  }

  return (
    <div className="tour" role="presentation">
      {rect ? (
        <div
          className="tour-spotlight"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
          aria-hidden="true"
        />
      ) : (
        <div className="tour-scrim" aria-hidden="true" />
      )}
      <div
        ref={cardRef}
        className={rect ? 'tour-card' : 'tour-card centred'}
        style={cardStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
      >
        <div className="tour-card-head">
          <span className="eyebrow">{t('tour.progress', { n: index + 1, total: TOUR_STEPS.length })}</span>
          <button type="button" className="icon-button bare" onClick={endTour} aria-label={t('tour.skip')}>
            <X className="icon" aria-hidden="true" />
          </button>
        </div>
        <h2 id="tour-title">{t(`tour.steps.${step}.title`)}</h2>
        <p id="tour-body">{t(`tour.steps.${step}.body`)}</p>
        <div className="tour-actions">
          {index > 0 && (
            <button type="button" className="secondary" onClick={() => setIndex(index - 1)}>
              {t('tour.back')}
            </button>
          )}
          <button type="button" className="primary" onClick={() => (last ? endTour() : setIndex(index + 1))}>
            {t(last ? 'tour.done' : 'tour.next')}
          </button>
        </div>
      </div>
    </div>
  )
}
