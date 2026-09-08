import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'aslan-ui'
import { Check, ChevronDown, ChevronRight, History, Loader2, MoreHorizontal, Plus, RotateCcw } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'

import {
  listHabitsAsOf,
  logHabitEntry,
  unlogHabitEntry,
  writeObject,
  type HabitMeta,
} from '../../lib/cliService'
import {
  compareHabitsByUrgency,
  describeHabitCadence,
  describeHabitDueBadge,
  describeHabitRecency,
  isHabitDue,
  pluralizeDays,
} from '../../lib/habitFormat'
import { cn } from '../../lib/utils'
import HabitEditDialog from './HabitEditDialog'

interface HabitPanelProps {
  /** The daily note's date. Consistency is always measured as of this day. */
  date: string
}

/**
 * The habits section of a daily note: which practices are due on this day, how
 * long it has been since each last happened, and a one-click way to log one.
 *
 * It opens itself only when there is something to see — a habit due or overdue
 * on this date, or one already logged on it (DEC-81).
 */
export default function HabitPanel({ date }: HabitPanelProps) {
  const [habits, setHabits] = useState<HabitMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<boolean | null>(null)
  const [busyHabitId, setBusyHabitId] = useState<string | null>(null)
  const [historyHabit, setHistoryHabit] = useState<HabitMeta | null>(null)
  const [editing, setEditing] = useState<HabitMeta | 'new' | null>(null)

  const load = useCallback(async () => {
    if (!date) return
    setError(null)
    try {
      // Retired habits come along so the panel can offer them back; they are
      // separated out below rather than listed with the active ones.
      setHabits(await listHabitsAsOf(date, { includeRetired: true }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => {
    setLoading(true)
    // A different day is a different question, so let the panel re-decide
    // whether it should be open.
    setExpanded(null)
    void load()
  }, [load])

  const activeHabits = useMemo(
    () => [...habits].filter((habit) => habit.state === 'active').sort(compareHabitsByUrgency),
    [habits],
  )

  const loggedOnDate = useMemo(
    () => activeHabits.filter((habit) => habit.stats.state === 'logged'),
    [activeHabits],
  )
  const dueOnDate = useMemo(
    () => activeHabits.filter((habit) => isHabitDue(habit.stats.state)),
    [activeHabits],
  )

  // Auto-open when this day has something to say; the user's own toggle wins.
  const isExpanded = expanded ?? (dueOnDate.length > 0 || loggedOnDate.length > 0)

  const withBusy = useCallback(async (habitId: string, action: () => Promise<unknown>) => {
    setBusyHabitId(habitId)
    setError(null)
    try {
      await action()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyHabitId(null)
    }
  }, [load])

  const toggleLogged = useCallback((habit: HabitMeta) => (
    withBusy(habit.id, () => (
      habit.stats.state === 'logged'
        ? unlogHabitEntry(habit.id, date)
        : logHabitEntry(habit.id, date)
    ))
  ), [withBusy, date])

  const setHabitState = useCallback((habit: HabitMeta, state: 'active' | 'retired') => (
    withBusy(habit.id, () => writeObject('habit', { id: habit.id, state }))
  ), [withBusy])

  const summary = loading
    ? 'Loading…'
    : dueOnDate.length > 0
      ? `${dueOnDate.length} due`
      : loggedOnDate.length > 0
        ? `${loggedOnDate.length} logged`
        : activeHabits.length === 0
          ? 'None yet'
          : 'Nothing due'

  return (
    <div className="rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)]">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded(!isExpanded)}
          className="flex flex-1 items-center gap-2 text-left"
          aria-expanded={isExpanded}
        >
          {isExpanded
            ? <ChevronDown className="h-3.5 w-3.5 text-[var(--color-text-disabled)]" />
            : <ChevronRight className="h-3.5 w-3.5 text-[var(--color-text-disabled)]" />}
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
            Habits
          </span>
          <span
            className={cn(
              'text-xs',
              dueOnDate.length > 0
                ? 'font-semibold text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-disabled)]',
            )}
          >
            {summary}
          </span>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => { setExpanded(true); setEditing('new') }}
          className="h-6 w-6 text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)]"
          aria-label="New habit"
          title="New habit"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {isExpanded && (
        <div className="border-t border-[var(--color-border-subtle)] px-2 pb-2 pt-1">
          {error && (
            <Alert variant="destructive" className="mb-2 py-2 text-xs">
              {error}
            </Alert>
          )}
          {loading ? (
            <p className="px-2 py-3 text-xs italic text-[var(--color-text-disabled)]">Loading habits…</p>
          ) : activeHabits.length === 0 ? (
            <p className="px-2 py-3 text-xs italic text-[var(--color-text-disabled)]">
              No habits yet — click + to track a repeated practice.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {activeHabits.map((habit) => (
                <HabitRow
                  key={habit.id}
                  habit={habit}
                  busy={busyHabitId === habit.id}
                  onToggleLogged={() => { void toggleLogged(habit) }}
                  onShowHistory={() => setHistoryHabit(habit)}
                  onEdit={() => setEditing(habit)}
                  onRetire={() => { void setHabitState(habit, 'retired') }}
                />
              ))}
            </ul>
          )}
          <RetiredHabits
            habits={habits.filter((habit) => habit.state === 'retired')}
            busyHabitId={busyHabitId}
            onReactivate={(habit) => { void setHabitState(habit, 'active') }}
          />
        </div>
      )}

      {historyHabit && (
        <HabitHistoryDialog habit={historyHabit} onClose={() => setHistoryHabit(null)} />
      )}
      {editing && (
        <HabitEditDialog
          habit={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load() }}
        />
      )}
    </div>
  )
}

function HabitRow({
  habit,
  busy,
  onToggleLogged,
  onShowHistory,
  onEdit,
  onRetire,
}: {
  habit: HabitMeta
  busy: boolean
  onToggleLogged: () => void
  onShowHistory: () => void
  onEdit: () => void
  onRetire: () => void
}) {
  const logged = habit.stats.state === 'logged'
  const badge = describeHabitDueBadge(habit.stats)
  const cadence = describeHabitCadence(habit)

  return (
    <li className="group flex items-center gap-2 rounded-[10px] px-2 py-1.5 hover:bg-[var(--color-surface-hover)]">
      <button
        type="button"
        onClick={onToggleLogged}
        disabled={busy}
        title={logged ? 'Remove this occurrence' : 'Log this habit on this day'}
        aria-label={logged ? `Remove ${habit.name} from this day` : `Log ${habit.name} on this day`}
        className={cn(
          'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors',
          logged
            ? 'border-transparent bg-[var(--color-accent, #1677ff)] text-white'
            : 'border-[var(--color-border-strong)] text-transparent hover:border-[var(--color-text-secondary)]',
          busy && 'opacity-60',
        )}
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin text-current" /> : <Check className="h-3 w-3" />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={cn(
            'truncate text-sm',
            logged ? 'text-[var(--color-text-secondary)]' : 'font-medium text-[var(--color-text-primary)]',
          )}>
            {habit.name}
          </span>
          {badge && (
            <span className={cn(
              'shrink-0 text-[11px] font-semibold uppercase tracking-[0.04em]',
              isHabitDue(habit.stats.state)
                ? 'text-[#d4380d]'
                : 'text-[var(--color-text-disabled)]',
            )}>
              {badge}
            </span>
          )}
        </div>
        <p className="truncate text-[11px] text-[var(--color-text-disabled)]">
          {describeHabitRecency(habit)}
          {cadence ? ` · ${cadence}` : ''}
          {habit.stats.entryCount > 0 ? ` · ${habit.stats.entryCount} logged` : ''}
        </p>
      </div>

      <GapSparkline gaps={habit.stats.gaps} interval={habit.stats.intervalDays} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-[var(--color-text-disabled)] opacity-0 transition-opacity hover:text-[var(--color-text-primary)] focus:opacity-100 group-hover:opacity-100"
            aria-label={`Actions for ${habit.name}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={onShowHistory}>
            <History className="mr-2 h-3.5 w-3.5" /> History
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onEdit}>Edit…</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onRetire}>Retire</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

/**
 * The rhythm at a glance: one bar per gap between occurrences, oldest to newest,
 * scaled against the habit's own cadence so a bar taller than the line is a gap
 * longer than intended.
 */
function GapSparkline({ gaps, interval }: { gaps: number[]; interval: number | null }) {
  const recent = gaps.slice(-10)
  if (recent.length < 2) return <div className="w-[64px] shrink-0" aria-hidden="true" />
  const ceiling = Math.max(...recent, interval ?? 0) || 1

  return (
    <div
      className="flex h-5 w-[64px] shrink-0 items-end gap-[2px]"
      title={`Recent gaps: ${recent.map((gap) => `${gap}d`).join(', ')}`}
    >
      {recent.map((gap, index) => (
        <span
          key={index}
          className={cn(
            'w-full rounded-[1px]',
            interval && gap > interval
              ? 'bg-[#ff9c6e]'
              : 'bg-[var(--color-border-strong)]',
          )}
          style={{ height: `${Math.max(12, Math.round((gap / ceiling) * 100))}%` }}
        />
      ))}
    </div>
  )
}

function RetiredHabits({
  habits,
  busyHabitId,
  onReactivate,
}: {
  habits: HabitMeta[]
  busyHabitId: string | null
  onReactivate: (habit: HabitMeta) => void
}) {
  const [open, setOpen] = useState(false)
  if (habits.length === 0) return null

  return (
    <div className="mt-1 border-t border-[var(--color-border-subtle)] pt-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-[11px] text-[var(--color-text-disabled)] hover:text-[var(--color-text-secondary)]"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Retired ({habits.length})
      </button>
      {open && (
        <ul className="space-y-0.5">
          {habits.map((habit) => (
            <li key={habit.id} className="flex items-center gap-2 rounded-[10px] px-2 py-1 hover:bg-[var(--color-surface-hover)]">
              <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-text-disabled)]">
                {habit.name}
                <span className="ml-2 text-[11px]">
                  {habit.stats.entryCount} logged{habit.retiredOn ? ` · retired ${habit.retiredOn}` : ''}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busyHabitId === habit.id}
                onClick={() => onReactivate(habit)}
                className="h-6 shrink-0 px-2 text-[11px] text-[var(--color-text-secondary)]"
              >
                <RotateCcw className="mr-1 h-3 w-3" /> Reactivate
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Every occurrence with the gap that preceded it — the "how long between" view. */
function HabitHistoryDialog({ habit, onClose }: { habit: HabitMeta; onClose: () => void }) {
  const rows = useMemo(() => {
    const sorted = [...habit.entries]
      .filter((entry) => entry.date <= habit.stats.asOfDate)
      .sort((a, b) => (a.date < b.date ? 1 : -1))
    return sorted.map((entry, index) => {
      const previous = sorted[index + 1]
      const gap = previous
        ? Math.round((Date.parse(`${entry.date}T00:00:00Z`) - Date.parse(`${previous.date}T00:00:00Z`)) / 86_400_000)
        : null
      return { ...entry, gap }
    })
  }, [habit])

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{habit.name}</DialogTitle>
          <DialogDescription>
            {habit.stats.entryCount} occurrence{habit.stats.entryCount === 1 ? '' : 's'}
            {habit.stats.medianGapDays !== null ? ` · typically every ${pluralizeDays(habit.stats.medianGapDays)}` : ''}
            {habit.stats.averageGapDays !== null ? ` · average ${pluralizeDays(habit.stats.averageGapDays)}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[340px] overflow-auto">
          {rows.length === 0 ? (
            <p className="py-4 text-sm italic text-[var(--color-text-disabled)]">Nothing logged yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border-subtle)]">
              {rows.map((row) => (
                <li key={row.id || row.date} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="text-sm text-[var(--color-text-primary)]">{row.date}</span>
                  {row.note && (
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-text-secondary)]">{row.note}</span>
                  )}
                  <span className="shrink-0 text-xs text-[var(--color-text-disabled)]">
                    {row.gap === null ? 'first' : `+${pluralizeDays(row.gap)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
