import { Button, Input } from 'aslan-ui'
import { Check, CornerUpRight, Loader2, X } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'

import { formatDatePretty, getTodayDate } from '../../lib/dateUtils'
import type { Task } from '../../shared/types'
import { cn } from '../../lib/utils'

interface TaskRowProps {
  task: Task
  busy: boolean
  onToggle: () => void
  onEdit: (patch: { text?: string; dueDate?: string | null }) => void
  /** Opens the note this task was written in, focused on its own block. */
  onOpenSource: () => void
}

/** Where a task lives, phrased the way its note is titled. */
function describeSource(task: Task): string {
  if (task.noteType === 'daily-note') return task.noteDate ? formatDatePretty(task.noteDate) : 'Daily note'
  return task.noteTitle || 'Topic note'
}

export default function TaskRow({ task, busy, onToggle, onEdit, onOpenSource }: TaskRowProps) {
  const [editing, setEditing] = useState(false)
  const [draftText, setDraftText] = useState(task.text)
  const [draftDue, setDraftDue] = useState(task.dueDate ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const startEditing = () => {
    setDraftText(task.text)
    setDraftDue(task.dueDate ?? '')
    setEditing(true)
  }

  const commit = () => {
    const text = draftText.trim()
    const due = draftDue.trim()
    setEditing(false)
    const patch: { text?: string; dueDate?: string | null } = {}
    if (text && text !== task.text) patch.text = text
    if (due !== (task.dueDate ?? '')) patch.dueDate = due === '' ? null : due
    if (Object.keys(patch).length > 0) onEdit(patch)
  }

  const today = getTodayDate()
  const overdue = !task.done && Boolean(task.dueDate) && (task.dueDate as string) < today
  const dueToday = !task.done && task.dueDate === today

  return (
    <li className="group flex items-start gap-2.5 rounded-[10px] px-2 py-1.5 hover:bg-[var(--color-surface-hover)]">
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-label={task.done ? `Mark "${task.text}" not done` : `Mark "${task.text}" done`}
        title={task.done ? 'Mark not done' : 'Mark done'}
        className={cn(
          'mt-[3px] flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[4px] border transition-colors',
          task.done
            ? 'border-transparent bg-[var(--color-accent, #1677ff)] text-white'
            : 'border-[var(--color-border-strong)] text-transparent hover:border-[var(--color-text-secondary)]',
          busy && 'opacity-60',
        )}
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin text-current" /> : <Check className="h-3 w-3" />}
      </button>

      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Input
              ref={inputRef}
              value={draftText}
              onChange={(e) => setDraftText(e.target.value.replace(/\r?\n/g, ' '))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') setEditing(false)
              }}
              className="h-7 min-w-[180px] flex-1 text-sm"
            />
            <Input
              value={draftDue}
              onChange={(e) => setDraftDue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') setEditing(false)
              }}
              placeholder="YYYY-MM-DD"
              className="h-7 w-[130px] text-sm"
            />
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={commit} title="Save">
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(false)} title="Cancel">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-baseline gap-2">
            <button
              type="button"
              onClick={startEditing}
              className={cn(
                'min-w-0 break-words text-left text-sm',
                task.done
                  ? 'text-[var(--color-text-disabled)] line-through'
                  : 'text-[var(--color-text-primary)]',
              )}
              title="Click to edit"
            >
              {task.text || '(empty task)'}
            </button>
            {task.dueDate && (
              <span
                className={cn(
                  'shrink-0 text-[11px] font-semibold uppercase tracking-[0.04em]',
                  overdue ? 'text-[#d4380d]' : dueToday ? 'text-[var(--color-accent-metadata)]' : 'text-[var(--color-text-disabled)]',
                )}
              >
                {overdue ? 'Overdue · ' : dueToday ? 'Today · ' : ''}
                {formatDatePretty(task.dueDate)}
              </span>
            )}
          </div>
        )}
        <p className="truncate text-[11px] text-[var(--color-text-disabled)]">{describeSource(task)}</p>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onOpenSource}
        aria-label={`Open ${describeSource(task)}`}
        title={`Open ${describeSource(task)}`}
        className="h-6 w-6 shrink-0 text-[var(--color-text-disabled)] opacity-0 transition-opacity hover:text-[var(--color-text-primary)] focus:opacity-100 group-hover:opacity-100"
      >
        <CornerUpRight className="h-3.5 w-3.5" />
      </Button>
    </li>
  )
}
