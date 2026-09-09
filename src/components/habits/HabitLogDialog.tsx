import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from 'aslan-ui'
import { Check, Loader2, Plus } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'

import { listHabitsAsOf, logHabitEntry, unlogHabitEntry, type HabitMeta } from '../../lib/cliService'
import { formatDatePretty } from '../../lib/dateUtils'
import {
  compareHabitsByUrgency,
  describeHabitCadence,
  describeHabitDueBadge,
  describeHabitRecency,
  isHabitDue,
} from '../../lib/habitFormat'
import { cn } from '../../lib/utils'
import HabitEditDialog from './HabitEditDialog'

interface HabitLogDialogProps {
  /** The day the occurrence belongs to. */
  date: string
  onClose: () => void
  /** Fired after each log, unlog, or new habit so the calendar can refresh. */
  onChanged: () => void
}

/**
 * Adding a habit to a day almost always means "this practice happened today",
 * not "invent a new practice" — so the calendar opens this list of existing
 * habits first, with creating a new one kept as the deliberate second step.
 */
export default function HabitLogDialog({ date, onClose, onChanged }: HabitLogDialogProps) {
  const [habits, setHabits] = useState<HabitMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busyHabitId, setBusyHabitId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      setHabits(await listHabitsAsOf(date))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  // Retired habits stay out of the way; this list is for practices still kept.
  const activeHabits = useMemo(
    () => habits.filter((habit) => habit.state === 'active').sort(compareHabitsByUrgency),
    [habits],
  )

  const trimmedQuery = query.trim()
  const visibleHabits = useMemo(() => {
    const needle = trimmedQuery.toLowerCase()
    if (!needle) return activeHabits
    return activeHabits.filter((habit) => habit.name.toLowerCase().includes(needle))
  }, [activeHabits, trimmedQuery])

  const toggleLogged = useCallback(async (habit: HabitMeta) => {
    setBusyHabitId(habit.id)
    setError(null)
    try {
      if (habit.stats.state === 'logged') {
        await unlogHabitEntry(habit.id, date)
      } else {
        await logHabitEntry(habit.id, date)
      }
      await load()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyHabitId(null)
    }
  }, [date, load, onChanged])

  if (creating) {
    return (
      <HabitEditDialog
        habit={null}
        logOnDate={date}
        initialName={trimmedQuery}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false)
          setQuery('')
          void load()
          onChanged()
        }}
      />
    )
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Log a habit</DialogTitle>
          <DialogDescription>
            Mark which practices happened on {formatDatePretty(date)}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a habit…"
          />

          {error && <Alert variant="destructive" className="py-2 text-xs">{error}</Alert>}

          <div className="max-h-[320px] min-h-[120px] overflow-auto">
            {loading ? (
              <p className="px-2 py-3 text-xs italic text-[var(--color-text-disabled)]">Loading habits…</p>
            ) : visibleHabits.length === 0 ? (
              <p className="px-2 py-3 text-xs italic text-[var(--color-text-disabled)]">
                {activeHabits.length === 0
                  ? 'No habits yet — create one below.'
                  : `No habit matches “${trimmedQuery}”.`}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {visibleHabits.map((habit) => (
                  <HabitLogRow
                    key={habit.id}
                    habit={habit}
                    busy={busyHabitId === habit.id}
                    onToggle={() => { void toggleLogged(habit) }}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            New habit…
          </Button>
          <Button size="sm" onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function HabitLogRow({
  habit,
  busy,
  onToggle,
}: {
  habit: HabitMeta
  busy: boolean
  onToggle: () => void
}) {
  const logged = habit.stats.state === 'logged'
  const badge = describeHabitDueBadge(habit.stats)
  const cadence = describeHabitCadence(habit)

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-pressed={logged}
        className="flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left hover:bg-[var(--color-surface-hover)]"
      >
        <span
          className={cn(
            'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors',
            logged
              ? 'border-transparent bg-[var(--color-accent, #1677ff)] text-white'
              : 'border-[var(--color-border-strong)] text-transparent',
            busy && 'opacity-60',
          )}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin text-current" /> : <Check className="h-3 w-3" />}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn(
              'truncate text-sm',
              logged ? 'text-[var(--color-text-secondary)]' : 'font-medium text-[var(--color-text-primary)]',
            )}>
              {habit.name}
            </span>
            {badge && (
              <span className={cn(
                'shrink-0 text-[11px] font-semibold uppercase tracking-[0.04em]',
                isHabitDue(habit.stats.state) ? 'text-[#d4380d]' : 'text-[var(--color-text-disabled)]',
              )}>
                {badge}
              </span>
            )}
          </span>
          <span className="block truncate text-[11px] text-[var(--color-text-disabled)]">
            {describeHabitRecency(habit)}
            {cadence ? ` · ${cadence}` : ''}
          </span>
        </span>
      </button>
    </li>
  )
}
