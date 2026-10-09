/** Typed dates for DateField. Values are ISO calendar dates (`YYYY-MM-DD`), no time zone.
 *  Typing is always day first (DE `31.12.1990`, EN `31/12/1990`), as everywhere in the EU. */

export interface CalendarDate {
  year: number
  month: number // 1–12
  day: number
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function toIso({ year, month, day }: CalendarDate): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function fromIso(iso: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return null
  return valid(Number(match[1]), Number(match[2]), Number(match[3]))
}

function valid(year: number, month: number, day: number): CalendarDate | null {
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null
  return { year, month, day }
}

export function dateSeparator(language: string): string {
  return language.startsWith('de') ? '.' : '/'
}

export function formatTyped(iso: string, language: string): string {
  const date = fromIso(iso)
  if (!date) return ''
  const sep = dateSeparator(language)
  return [String(date.day).padStart(2, '0'), String(date.month).padStart(2, '0'), date.year].join(sep)
}

/** Day, month, year with `.`, `/`, `-` or spaces; ISO is accepted too. Two-digit years mean
 *  the most recent such year not after `today`. Returns null if it is not a real date. */
export function parseTyped(text: string, today: CalendarDate): CalendarDate | null {
  const trimmed = text.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return fromIso(trimmed)
  const parts = trimmed.split(/[./\-\s]+/)
  if (parts.length !== 3 || parts.some((part) => !/^\d+$/.test(part))) return null
  const [day, month, yearText] = parts
  let year = Number(yearText)
  if (yearText.length === 2) {
    const century = Math.floor(today.year / 100) * 100
    year = century + year > today.year ? century - 100 + year : century + year
  } else if (yearText.length !== 4) {
    return null
  }
  return valid(year, Number(month), Number(day))
}

export function compareDates(a: CalendarDate, b: CalendarDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day
}

export function todayDate(now = new Date()): CalendarDate {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }
}

/** Shift by days, keeping to the calendar (handles month and year ends). */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() }
}

/** Same day in another month, clamped to that month's length (31 Jan + 1 month → 28/29 Feb). */
export function addMonths(date: CalendarDate, months: number): CalendarDate {
  const index = date.year * 12 + (date.month - 1) + months
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) }
}

/** Monday-first weekday, 0 = Monday … 6 = Sunday. */
export function weekdayMondayFirst(date: CalendarDate): number {
  return (new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay() + 6) % 7
}
