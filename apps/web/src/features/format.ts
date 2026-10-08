export function formatDate(iso: string, language: string): string {
  return new Date(iso).toLocaleDateString(language.startsWith('en') ? 'en-GB' : 'de-DE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** Minutes:seconds from the start of the recording. */
export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function locale(language: string): string {
  return language.startsWith('en') ? 'en-GB' : 'de-DE'
}

/** Clock time, e.g. "14:30". */
export function formatTime(iso: string, language: string): string {
  return new Date(iso).toLocaleTimeString(locale(language), { hour: '2-digit', minute: '2-digit' })
}

/** Long date for headings, e.g. "Friday, 9 October". */
export function formatLongDate(date: Date, language: string): string {
  return date.toLocaleDateString(locale(language), { weekday: 'long', day: 'numeric', month: 'long' })
}

export function isSameDay(iso: string, day: Date): boolean {
  return new Date(iso).toDateString() === day.toDateString()
}
