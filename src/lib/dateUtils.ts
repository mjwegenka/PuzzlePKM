import { format, parseISO, addDays, subDays, isToday, isYesterday, formatDistanceToNow, isValid } from 'date-fns'

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


export function formatRelative(isoString: string): string {
  return formatDistanceToNow(parseISO(isoString), { addSuffix: true })
}

export function prevDay(dateStr: string): string {
  return format(subDays(parseISO(dateStr), 1), 'yyyy-MM-dd')
}

export function nextDay(dateStr: string): string {
  return format(addDays(parseISO(dateStr), 1), 'yyyy-MM-dd')
}
