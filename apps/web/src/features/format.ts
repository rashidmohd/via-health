export function formatDate(iso: string, language: string): string {
  return new Date(iso).toLocaleDateString(language.startsWith('en') ? 'en-GB' : 'de-DE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
