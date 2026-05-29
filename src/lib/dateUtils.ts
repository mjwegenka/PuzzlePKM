import { format, parse, parseISO, addDays, subDays, isToday, isYesterday, formatDistanceToNow, isValid } from 'date-fns'

export function getTodayDate(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

export function formatDateHeading(dateStr: string): string {
  const date = parseISO(dateStr)
  return format(date, 'EEEE, MMMM d, yyyy')
}

export function formatDateShort(dateStr: string): string {
  const date = parseISO(dateStr)
  if (isToday(date)) return 'Today'
  if (isYesterday(date)) return 'Yesterday'
  return format(date, 'MMM d, yyyy')
}

export function formatDatePretty(dateStr?: string | null): string {
  const value = (dateStr ?? '').trim()
  if (!value) return ''
  const date = parseISO(value)
  if (!isValid(date)) return value
  return format(date, 'MMMM d, yyyy')
}

export function formatWeekdayShort(dateStr?: string | null): string {
  const value = (dateStr ?? '').trim()
  if (!value) return ''
  const date = parseISO(value)
  if (!isValid(date)) return ''
  return format(date, 'EEE')
}

export function formatWeekdayFull(dateStr?: string | null): string {
  const value = (dateStr ?? '').trim()
  if (!value) return ''
  const date = parseISO(value)
  if (!isValid(date)) return ''
  return format(date, 'EEEE')
}


export function formatRelative(isoString: string): string {
  return formatDistanceToNow(parseISO(isoString), { addSuffix: true })
}

export function prevDay(dateStr: string): string {
  return format(subDays(parseISO(dateStr), 1), 'yyyy-MM-dd')
}

export function nextDay(dateStr: string): string {
  return format(addDays(parseISO(dateStr), 1), 'yyyy-MM-dd')
}

/**
 * Try to parse a freeform mention query as a specific calendar date.
 * Supports:
 *   - Exact ISO dates: "2026-06-15"
 *   - "today", "tomorrow", "yesterday"
 *   - "Month Day" patterns: "june 15", "jun 15", "june 15 2026"
 * Returns a "YYYY-MM-DD" string on success, or null if not a recognizable date.
 */
export function parseDateQueryToISO(query: string): string | null {
  const q = query.trim().toLowerCase()
  if (!q) return null

  if (q === 'today') return format(new Date(), 'yyyy-MM-dd')
  if (q === 'tomorrow') return format(addDays(new Date(), 1), 'yyyy-MM-dd')
  if (q === 'yesterday') return format(subDays(new Date(), 1), 'yyyy-MM-dd')

  // Exact ISO date: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(q)) {
    const d = parseISO(q)
    return isValid(d) ? q : null
  }

  // "Month Day" or "Month Day Year": e.g. "june 15", "jun 15 2026"
  const monthDayFormats = ['MMMM d', 'MMM d', 'MMMM d yyyy', 'MMM d yyyy', 'MMMM do', 'MMM do']
  const currentYear = new Date().getFullYear()
  for (const fmt of monthDayFormats) {
    try {
      const refDate = new Date(currentYear, 0, 1) // reference date for parse
      const parsed = parse(q, fmt, refDate)
      if (isValid(parsed)) {
        return format(parsed, 'yyyy-MM-dd')
      }
    } catch {
      // try next format
    }
  }

  return null
}
