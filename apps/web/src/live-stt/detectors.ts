/**
 * Capture detectors: a fixed, named whitelist of keyword rules (German + English) that turn
 * transcript text into documentation chips (plan 0007, live-transcript-preview skill).
 *
 * Documentation only. Never sentiment, emotion, mood, risk or "interesting moment" detection
 * (CLAUDE.md rules 11–13). Every chip is a suggestion the therapist confirms or removes.
 */

export type CaptureKind = 'action_item' | 'date' | 'term' | 'bookmark'

export interface DetectedCapture {
  kind: CaptureKind
  /** The sentence the chip came from. */
  text: string
  atMs: number
  /** Stable per session, so a suggestion is decided only once. */
  key: string
}

export interface TextSpan {
  text: string
  start_ms: number
}

/** Whole-word match that also works with umlauts (JS \b is ASCII-only). */
function words(...alternatives: string[]): RegExp {
  return new RegExp(`(?<!\\p{L})(?:${alternatives.join('|')})(?!\\p{L})`, 'iu')
}

// --- action items: a task verb AND a time hint, not negated -------------------------

const TASK_VERB = words(
  // German (infinitive / zu-infinitive / imperative forms; not past participles)
  'aufschreiben', 'aufzuschreiben', 'notieren', 'zu notieren', 'üben', 'zu üben',
  'ausprobieren', 'auszuprobieren', 'beobachten', 'zu beobachten', 'lesen', 'zu lesen',
  'tagebuch führen', 'protokollieren', 'festhalten',
  // English
  'write (?:it |them |this |that |these |things )?down', 'note (?:it )?down', 'practi[cs]e',
  'try', 'keep a (?:diary|journal|log)', 'read', 'track', 'observe',
)
// Separable German verbs: "Schreiben Sie … auf", "Probieren Sie … aus"
const SEPARABLE_TASK = /(?<!\p{L})(?:schreiben sie|probieren sie)(?!\p{L}).*(?<!\p{L})(?:auf|aus)(?!\p{L})/iu

const TIME_HINT = words(
  'bis (?:zur |zum )?(?:nächsten?|kommenden?) (?:woche|mal|sitzung|termin)',
  'bis zum nächsten mal', 'bis nächste woche', 'jeden (?:abend|morgen|tag)', 'täglich',
  'diese woche', 'in der nächsten woche', 'bis dahin',
  'by next (?:week|time|session)', 'until next (?:week|time|session)', 'before next (?:week|time|session)',
  'every (?:day|evening|morning|night)', 'daily', 'this week', 'until then',
)

const NEGATION = words('nie', 'niemals', 'nicht', 'kein', 'keine', 'never', 'not', "don't", 'do not')

function isActionItem(sentence: string): boolean {
  return (
    (TASK_VERB.test(sentence) || SEPARABLE_TASK.test(sentence)) &&
    TIME_HINT.test(sentence) &&
    !NEGATION.test(sentence)
  )
}

// --- appointments: a when AND a meeting word ------------------------------------------

const WHEN = words(
  'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'gleiche zeit', 'same time', 'nächste woche', 'next week', 'morgen', 'tomorrow',
  'am \\d{1,2}\\.', 'on the \\d{1,2}(?:st|nd|rd|th)?', '\\d{1,2}(?::\\d{2})? ?uhr',
  '\\d{1,2}(?::\\d{2})? ?(?:am|pm)', 'um \\d{1,2}(?::\\d{2})?',
)
const MEETING = words(
  'termin', 'sehen uns', 'treffen uns', 'sitzung', 'nächstes mal', 'nächste stunde',
  'appointment', 'see you', 'meet', 'session', 'next time',
)
const PAST = words('war', 'hatte', 'hatten', 'waren', 'was', 'had', 'were')

function isAppointment(sentence: string): boolean {
  return WHEN.test(sentence) && MEETING.test(sentence) && !PAST.test(sentence)
}

// --- terms: the practice's own list (Settings page, later) ----------------------------

function termIn(sentence: string, terms: readonly string[]): string | null {
  return terms.find((term) => term.trim() && words(escapeRegExp(term.trim())).test(sentence)) ?? null
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// --- entry point ---------------------------------------------------------------------

const MAX_TEXT = 200

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/u)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Detect documentation chips in transcript spans (segments with start time). */
export function detectCaptures(spans: readonly TextSpan[], terms: readonly string[] = []): DetectedCapture[] {
  const found: DetectedCapture[] = []
  const seen = new Set<string>()
  for (const span of spans) {
    sentences(span.text).forEach((sentence, index) => {
      const atMs = span.start_ms
      const add = (kind: CaptureKind, text: string) => {
        const key = `${kind}:${atMs}:${index}`
        if (seen.has(key)) return
        seen.add(key)
        found.push({ kind, text: text.slice(0, MAX_TEXT), atMs, key })
      }
      if (isActionItem(sentence)) add('action_item', sentence)
      if (isAppointment(sentence)) add('date', sentence)
      const term = termIn(sentence, terms)
      if (term) add('term', term)
    })
  }
  return found
}

export function bookmarkCapture(atMs: number): DetectedCapture {
  return { kind: 'bookmark', text: '', atMs, key: `bookmark:${atMs}` }
}
