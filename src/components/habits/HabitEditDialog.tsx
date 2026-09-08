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
import { Loader2 } from 'lucide-react'
import React, { useState } from 'react'

import { logHabitEntry, writeObject, type HabitMeta } from '../../lib/cliService'
import { formatDatePretty } from '../../lib/dateUtils'
import type { Habit, HabitCadenceMode } from '../../shared/types'
import { cn } from '../../lib/utils'

interface CadenceOption {
  value: HabitCadenceMode
  label: string
  hint: string
}

const CADENCE_OPTIONS: CadenceOption[] = [
  { value: 'observed', label: 'Learn my rhythm', hint: 'Due when the gap exceeds your own typical one' },
  { value: 'target', label: 'Every so many days', hint: 'Due on a schedule you set' },
  { value: 'none', label: "Don't track — record only", hint: 'Never becomes due; keeps the history' },
]

interface HabitEditDialogProps {
  /** The habit being edited, or null to create a new one. */
  habit: HabitMeta | null
  /**
   * When set, the dialog offers to log an occurrence on this date as part of
   * creating the habit — the Calendar adds a habit from a day for a reason.
   */
  logOnDate?: string
  onClose: () => void
  onSaved: (habit: Habit) => void
}

export default function HabitEditDialog({ habit, logOnDate, onClose, onSaved }: HabitEditDialogProps) {
  const [name, setName] = useState(habit?.name ?? '')
  const [cadenceMode, setCadenceMode] = useState<HabitCadenceMode>(habit?.cadenceMode ?? 'observed')
  const [interval, setInterval] = useState(
    habit?.targetIntervalDays == null ? '' : String(habit.targetIntervalDays),
  )
  const [alsoLog, setAlsoLog] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const offerLogging = Boolean(logOnDate) && !habit

  const handleSave = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('A habit needs a name.')
      return
    }
    const raw = interval.trim()
    const targetIntervalDays = raw === '' ? null : Number(raw)
    if (cadenceMode === 'target' && (targetIntervalDays === null || !Number.isFinite(targetIntervalDays) || targetIntervalDays <= 0)) {
      setError('Give a positive number of days, or choose another cadence.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      // Tags are deliberately omitted so an edit here never clears them.
      const saved = await writeObject('habit', {
        ...(habit ? { id: habit.id } : {}),
        name: trimmed,
        cadenceMode,
        targetIntervalDays: cadenceMode === 'target' ? targetIntervalDays : null,
      }) as unknown as Habit
      const withEntry = offerLogging && alsoLog && logOnDate
        ? await logHabitEntry(String(saved.id), logOnDate)
        : saved
      onSaved(withEntry)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{habit ? 'Edit habit' : 'New habit'}</DialogTitle>
          <DialogDescription>
            A habit is a practice you repeat. Its history is the log of days you did it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-disabled)]">
              Name
            </label>
            <Input
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value.replace(/\r?\n/g, ' '))}
              placeholder="Confession, Examen, Spiritual direction…"
              maxLength={255}
            />
          </div>

          <div className="space-y-1.5">
            <span className="block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-disabled)]">
              When is it due?
            </span>
            <div className="space-y-1">
              {CADENCE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={cn(
                    'flex cursor-pointer items-start gap-2.5 rounded-[10px] border px-3 py-2 transition-colors',
                    cadenceMode === option.value
                      ? 'border-[var(--color-border-strong)] bg-[var(--color-surface-hover)]'
                      : 'border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-hover)]',
                  )}
                >
                  <input
                    type="radio"
                    name="habit-cadence"
                    className="mt-1"
                    checked={cadenceMode === option.value}
                    onChange={() => setCadenceMode(option.value)}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-sm text-[var(--color-text-primary)]">{option.label}</span>
                    <span className="text-[11px] text-[var(--color-text-disabled)]">{option.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {cadenceMode === 'target' && (
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-disabled)]">
                Days between
              </label>
              <Input
                value={interval}
                onChange={(e) => setInterval(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="30"
                inputMode="numeric"
              />
            </div>
          )}

          {offerLogging && logOnDate && (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-text-secondary)]">
              <input type="checkbox" checked={alsoLog} onChange={(e) => setAlsoLog(e.target.checked)} />
              Log it on {formatDatePretty(logOnDate)}
            </label>
          )}

          {error && <Alert variant="destructive" className="py-2 text-xs">{error}</Alert>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={() => { void handleSave() }} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
