import { addMonths, formatTyped, parseTyped, weekdayMondayFirst } from './dateInput'

const TODAY = { year: 2026, month: 10, day: 9 }

describe('typed dates', () => {
  it('reads day-first dates with any separator, and ISO', () => {
    expect(parseTyped('31.12.1990', TODAY)).toEqual({ year: 1990, month: 12, day: 31 })
    expect(parseTyped('1/2/1990', TODAY)).toEqual({ year: 1990, month: 2, day: 1 })
    expect(parseTyped(' 01-02-1990 ', TODAY)).toEqual({ year: 1990, month: 2, day: 1 })
    expect(parseTyped('1990-02-01', TODAY)).toEqual({ year: 1990, month: 2, day: 1 })
  })

  it('reads two-digit years as the latest such year not in the future', () => {
    expect(parseTyped('1.2.90', TODAY)?.year).toBe(1990)
    expect(parseTyped('1.2.26', TODAY)?.year).toBe(2026)
    expect(parseTyped('1.2.27', TODAY)?.year).toBe(1927)
  })

  it('rejects dates that do not exist or are incomplete', () => {
    expect(parseTyped('31.02.1990', TODAY)).toBeNull()
    expect(parseTyped('29.02.2023', TODAY)).toBeNull()
    expect(parseTyped('29.02.2024', TODAY)).not.toBeNull()
    expect(parseTyped('12.1990', TODAY)).toBeNull()
    expect(parseTyped('1.2.199', TODAY)).toBeNull()
    expect(parseTyped('a.b.c', TODAY)).toBeNull()
  })

  it('formats in the style of the UI language', () => {
    expect(formatTyped('1990-02-01', 'de')).toBe('01.02.1990')
    expect(formatTyped('1990-02-01', 'en')).toBe('01/02/1990')
    expect(formatTyped('', 'de')).toBe('')
  })

  it('moves by months without overflowing short months', () => {
    expect(addMonths({ year: 2024, month: 1, day: 31 }, 1)).toEqual({ year: 2024, month: 2, day: 29 })
    expect(addMonths({ year: 2024, month: 1, day: 15 }, -1)).toEqual({ year: 2023, month: 12, day: 15 })
  })

  it('starts weeks on Monday', () => {
    expect(weekdayMondayFirst({ year: 2026, month: 10, day: 5 })).toBe(0) // Monday
    expect(weekdayMondayFirst({ year: 2026, month: 10, day: 11 })).toBe(6) // Sunday
  })
})
