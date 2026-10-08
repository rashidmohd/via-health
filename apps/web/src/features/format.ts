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
