import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { locale } from '../features/format'
import {
  addDays,
  addMonths,
  compareDates,
  daysInMonth,
  formatTyped,
  fromIso,
  parseTyped,
  toIso,
  todayDate,
  weekdayMondayFirst,
  type CalendarDate,
} from './dateInput'

const EARLIEST_YEAR = 1900

/** Date input that looks the same in every browser: type it (day first) or pick it from a
 *  calendar. `onChange` gets an ISO date, '' when empty, or null while the text is not a
 *  valid date (the form should not submit then). */
export function DateField({
  id,
  value,
  onChange,
  min,
  max,
}: {
  id: string
  value: string
  onChange: (iso: string | null) => void
  min?: string
  max?: string
}) {
  const { t, i18n } = useTranslation()
  const language = i18n.language
  const [text, setText] = useState(() => formatTyped(value, language))
  // The error shows once the user has left the field, never while they are still typing.
  const [touched, setTouched] = useState(false)
  const [open, setOpen] = useState(false)
  const errorId = useId()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  // Values set from outside (form reset, loaded data) replace the typed text; a language
  // switch rewrites a valid date in that language's style. Tracked during render, not in effects.
  const [seen, setSeen] = useState({ value, language })
  const bounds = useMemo(() => ({ min: min ? fromIso(min) : null, max: max ? fromIso(max) : null }), [min, max])
  const parsedIso = parseInRange(text, bounds.min, bounds.max)
  const invalid = touched && parsedIso === null

  if (seen.value !== value || seen.language !== language) {
    setSeen({ value, language })
    if (seen.value !== value) setText(formatTyped(value, language))
    else if (parsedIso) setText(formatTyped(parsedIso, language))
  }

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  function update(next: string) {
    setText(next)
    const iso = parseInRange(next, bounds.min, bounds.max)
    setSeen({ value: iso ?? '', language })
    onChange(iso)
  }

  function pick(date: CalendarDate) {
    update(formatTyped(toIso(date), language))
    setTouched(true)
    setOpen(false)
    toggleRef.current?.focus()
  }

  return (
    <div className="date-field" ref={wrapperRef}>
      <div className="date-field-control">
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          placeholder={t('dateField.placeholder')}
          value={text}
          onChange={(event) => update(event.target.value)}
          onBlur={() => {
            setTouched(true)
            if (parsedIso) setText(formatTyped(parsedIso, language)) // 1.2.90 → 01.02.1990
          }}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
        />
        <button
          ref={toggleRef}
          type="button"
          className="icon-button bare date-field-toggle"
          onClick={() => setOpen((was) => !was)}
          aria-label={t('dateField.choose')}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <CalendarDays className="icon" aria-hidden="true" />
        </button>
      </div>
      {invalid && (
        <p id={errorId} className="field-error">
          {t('dateField.invalid', { example: formatTyped('1990-12-31', language) })}
        </p>
      )}
      {open && (
        <Calendar
          selected={fromIso(value)}
          min={bounds.min}
          max={bounds.max}
          onPick={pick}
          onClose={() => {
            setOpen(false)
            toggleRef.current?.focus()
          }}
        />
      )}
    </div>
  )
}

function Calendar({
  selected,
  min,
  max,
  onPick,
  onClose,
}: {
  selected: CalendarDate | null
  min: CalendarDate | null
  max: CalendarDate | null
  onPick: (date: CalendarDate) => void
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const today = todayDate()
  const [focused, setFocused] = useState<CalendarDate>(() => clamp(selected ?? today, min, max))
  const gridRef = useRef<HTMLDivElement>(null)
  const [keyboard, setKeyboard] = useState(false)

  useEffect(() => {
    if (keyboard) gridRef.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus()
  }, [focused, keyboard])

  const monthNames = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale(i18n.language), { month: 'long', timeZone: 'UTC' })
    return Array.from({ length: 12 }, (_, i) => format.format(Date.UTC(2024, i, 1)))
  }, [i18n.language])
  const weekdays = useMemo(() => {
    const short = new Intl.DateTimeFormat(locale(i18n.language), { weekday: 'short', timeZone: 'UTC' })
    const long = new Intl.DateTimeFormat(locale(i18n.language), { weekday: 'long', timeZone: 'UTC' })
    // 2024-01-01 was a Monday.
    return Array.from({ length: 7 }, (_, i) => ({
      short: short.format(Date.UTC(2024, 0, 1 + i)),
      long: long.format(Date.UTC(2024, 0, 1 + i)),
    }))
  }, [i18n.language])
  const dayLabel = useMemo(
    () => new Intl.DateTimeFormat(locale(i18n.language), { dateStyle: 'full', timeZone: 'UTC' }),
    [i18n.language],
  )

  const firstYear = min?.year ?? EARLIEST_YEAR
  const lastYear = max?.year ?? today.year + 10
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => lastYear - i)

  const outside = (date: CalendarDate) =>
    (min !== null && compareDates(date, min) < 0) || (max !== null && compareDates(date, max) > 0)

  const lead = weekdayMondayFirst({ ...focused, day: 1 })
  const length = daysInMonth(focused.year, focused.month)
  const cells: (CalendarDate | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length }, (_, i) => ({ year: focused.year, month: focused.month, day: i + 1 })),
  ]
  while (cells.length % 7) cells.push(null)
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7))

  function showMonth(year: number, month: number) {
    setFocused(clamp({ year, month, day: Math.min(focused.day, daysInMonth(year, month)) }, min, max))
  }

  function move(next: CalendarDate) {
    setKeyboard(true)
    setFocused(clamp(next, min, max))
  }

  function onGridKey(event: KeyboardEvent) {
    const steps: Record<string, () => CalendarDate> = {
      ArrowLeft: () => addDays(focused, -1),
      ArrowRight: () => addDays(focused, 1),
      ArrowUp: () => addDays(focused, -7),
      ArrowDown: () => addDays(focused, 7),
      PageUp: () => addMonths(focused, event.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focused, event.shiftKey ? 12 : 1),
      Home: () => addDays(focused, -weekdayMondayFirst(focused)),
      End: () => addDays(focused, 6 - weekdayMondayFirst(focused)),
    }
    const step = steps[event.key]
    if (!step) return
    event.preventDefault()
    move(step())
  }

  return (
    <div
      className="date-popover"
      role="dialog"
      aria-label={t('dateField.choose')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="date-popover-header">
        <button
          type="button"
          className="icon-button bare"
          onClick={() => setFocused(clamp(addMonths(focused, -1), min, max))}
          aria-label={t('dateField.previousMonth')}
        >
          <ChevronLeft className="icon" aria-hidden="true" />
        </button>
        <select
          aria-label={t('dateField.month')}
          value={focused.month}
          onChange={(event) => showMonth(focused.year, Number(event.target.value))}
        >
          {monthNames.map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </select>
        <select
          aria-label={t('dateField.year')}
          value={focused.year}
          onChange={(event) => showMonth(Number(event.target.value), focused.month)}
        >
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="icon-button bare"
          onClick={() => setFocused(clamp(addMonths(focused, 1), min, max))}
          aria-label={t('dateField.nextMonth')}
        >
          <ChevronRight className="icon" aria-hidden="true" />
        </button>
      </div>
      <div role="grid" className="date-grid" ref={gridRef} onKeyDown={onGridKey}>
        <div role="row" className="date-row">
          {weekdays.map((day) => (
            <span role="columnheader" key={day.long} aria-label={day.long} className="date-weekday">
              <span aria-hidden="true">{day.short}</span>
            </span>
          ))}
        </div>
        {weeks.map((week, w) => (
          <div role="row" className="date-row" key={w}>
            {week.map((date, d) =>
              date ? (
                <span role="gridcell" key={d} aria-selected={selected !== null && compareDates(date, selected) === 0}>
                  <button
                    type="button"
                    className={[
                      'date-day',
                      selected && compareDates(date, selected) === 0 ? 'is-selected' : '',
                      compareDates(date, today) === 0 ? 'is-today' : '',
                    ].join(' ')}
                    tabIndex={date.day === focused.day ? 0 : -1}
                    disabled={outside(date)}
                    aria-label={dayLabel.format(Date.UTC(date.year, date.month - 1, date.day))}
                    aria-current={compareDates(date, today) === 0 ? 'date' : undefined}
                    onClick={() => onPick(date)}
                  >
                    {date.day}
                  </button>
                </span>
              ) : (
                <span role="gridcell" key={d} />
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function clamp(date: CalendarDate, min: CalendarDate | null, max: CalendarDate | null): CalendarDate {
  if (min && compareDates(date, min) < 0) return min
  if (max && compareDates(date, max) > 0) return max
  return date
}

/** '' for empty, ISO for a valid date within the bounds, null otherwise. */
function parseInRange(typed: string, min: CalendarDate | null, max: CalendarDate | null): string | null {
  if (!typed.trim()) return ''
  const date = parseTyped(typed, todayDate())
  if (!date) return null
  if ((min && compareDates(date, min) < 0) || (max && compareDates(date, max) > 0)) return null
  return toIso(date)
}
