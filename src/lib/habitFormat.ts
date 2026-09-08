import type { HabitDueState, HabitStats } from '../shared/types'

/**
 * Phrasing for habit cadence and due state. Shared so the Library board and the
 * daily-note panel describe the same habit the same way. All the arithmetic
 * happens in the CLI (`cli/objects/habit/stats.mjs`); this only puts words to it.
 */

interface HabitLike {
  name: string
  targetIntervalDays: number | null
  stats: HabitStats
}

export function pluralizeDays(days: number): string {
  return `${days} ${Math.abs(days) === 1 ? 'day' : 'days'}`
}

/** "every ~34 days" (observed) or "every 30 days" (an explicit target). */
export function describeHabitCadence(habit: HabitLike): string | undefined {
  const { intervalDays, intervalSource } = habit.stats
  if (!intervalDays) return undefined
  return intervalSource === 'target'
    ? `every ${pluralizeDays(intervalDays)}`
    : `every ~${pluralizeDays(intervalDays)}`
}

/** "Last 143 days ago" / "Logged today" / "Never logged". */
export function describeHabitRecency(habit: HabitLike): string {
  const { lastDate, daysSinceLast, state } = habit.stats
  if (!lastDate) return 'Never logged'
  if (state === 'logged') return 'Logged today'
  if (daysSinceLast === null) return `Last on ${lastDate}`
  if (daysSinceLast === 0) return 'Logged today'
  if (daysSinceLast === 1) return 'Last yesterday'
  return `Last ${pluralizeDays(daysSinceLast)} ago`
}

/** The short badge: "Overdue 113d", "Due today", "In 5d". */
export function describeHabitDueBadge(stats: HabitStats): string | null {
  switch (stats.state) {
    case 'logged':
      return 'Logged'
    case 'overdue':
      return stats.daysOverdue === null ? 'Overdue' : `Overdue ${stats.daysOverdue}d`
    case 'due':
      return 'Due today'
    case 'on-track':
      return stats.daysUntilDue === null ? 'On track' : `In ${stats.daysUntilDue}d`
    default:
      return null
  }
}

export function isHabitDue(state: HabitDueState): boolean {
  return state === 'due' || state === 'overdue'
}

/** Ordering for the panel: what needs attention first, then longest-neglected. */
export function compareHabitsByUrgency(a: HabitLike, b: HabitLike): number {
  const rank = (state: HabitDueState) => {
    if (state === 'overdue') return 0
    if (state === 'due') return 1
    if (state === 'on-track') return 2
    if (state === 'untracked') return 3
    return 4 // logged — already handled today, so it sinks
  }
  const byState = rank(a.stats.state) - rank(b.stats.state)
  if (byState !== 0) return byState
  const byGap = (b.stats.daysSinceLast ?? -1) - (a.stats.daysSinceLast ?? -1)
  if (byGap !== 0) return byGap
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}
