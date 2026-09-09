import { Alert, Input } from 'aslan-ui'
import { ChevronDown, ChevronRight, Loader2, Plus } from 'lucide-react'
import React, { useCallback, useEffect, useState } from 'react'

import { addTask, listTasks, setTask } from '../../lib/cliService'
import { formatDatePretty, getTodayDate } from '../../lib/dateUtils'
import type { Task } from '../../shared/types'
import TaskRow from './TaskRow'

interface TaskInboxProps {
  /** Opens the note a task came from, focused on the block holding it. */
  onOpenSource: (target: { noteId: string; noteType: Task['noteType']; blockId: string }) => void | Promise<void>
  /** Signals the Library to refresh, since capture can create today's daily note. */
  onTasksChanged?: () => void | Promise<void>
}

/**
 * Every open task across daily and topic notes (DEC-83). Ordering and the
 * three-day cutoff for completed tasks both come from the CLI, so this renders
 * the list it is given rather than deciding what belongs in it.
 */
export default function TaskInbox({ onOpenSource, onTasksChanged }: TaskInboxProps) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [expanded, setExpanded] = useState(true)

  const load = useCallback(async () => {
    setError(null)
    try {
      setTasks(await listTasks())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const mutate = useCallback(async (id: string, action: () => Promise<unknown>) => {
    setBusyId(id)
    setError(null)
    try {
      await action()
      await load()
      await onTasksChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }, [load, onTasksChanged])

  const handleCapture = async () => {
    const text = draft.trim()
    if (!text) return
    setAdding(true)
    setError(null)
    try {
      await addTask(text)
      setDraft('')
      await load()
      await onTasksChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAdding(false)
    }
  }

  const openCount = tasks.filter((task) => !task.done).length

  return (
    <section className="rounded-[16px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)]/80">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-2">
          {expanded
            ? <ChevronDown className="h-3.5 w-3.5 text-[var(--color-text-disabled)]" />
            : <ChevronRight className="h-3.5 w-3.5 text-[var(--color-text-disabled)]" />}
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
            Tasks
          </span>
        </span>
        <span className="text-xs text-[var(--color-text-disabled)]">
          {loading ? 'Loading…' : openCount === 0 ? 'Nothing open' : `${openCount} open`}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-[var(--color-border-subtle)] px-2 py-2">
          {/* 14px matches the gap between two cards in the gallery below. */}
          <div className="mb-[14px] flex items-center gap-1.5 px-1">
            <Plus className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-disabled)]" />
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value.replace(/\r?\n/g, ' '))}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleCapture() }}
              placeholder={`Add a task…  (goes to ${formatDatePretty(getTodayDate())}; add due:YYYY-MM-DD for a date)`}
              className="h-8 flex-1 text-sm"
              disabled={adding}
            />
            {adding && <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--color-text-disabled)]" />}
          </div>

          {error && <Alert variant="destructive" className="mb-2 py-2 text-xs">{error}</Alert>}

          {loading ? (
            <p className="px-2 py-3 text-xs italic text-[var(--color-text-disabled)]">Loading tasks…</p>
          ) : tasks.length === 0 ? (
            <p className="px-2 py-3 text-xs italic text-[var(--color-text-disabled)]">
              No tasks — write <code>- [ ] something</code> in any note, or add one above.
            </p>
          ) : (
            <ul
              // Three columns while the pane is wide enough; the column width is
              // a floor, so the count drops rather than squeezing the rows.
              style={{ columnCount: 3, columnWidth: '260px', columnGap: '16px' }}
            >
              {tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  busy={busyId === task.id}
                  onToggle={() => { void mutate(task.id, () => setTask(task.id, { done: !task.done })) }}
                  onEdit={(patch) => { void mutate(task.id, () => setTask(task.id, patch)) }}
                  onOpenSource={() => {
                    void onOpenSource({ noteId: task.noteId, noteType: task.noteType, blockId: task.blockId })
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
