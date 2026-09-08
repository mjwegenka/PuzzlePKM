import { Alert, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from 'aslan-ui';
import { Loader2, Trash2 } from 'lucide-react'
import React, { useMemo, useState } from 'react'
import { deleteObject, type ResolvedObjectRef } from '../../lib/cliService'
import { describeHabitCadence, describeHabitRecency, pluralizeDays } from '../../lib/habitFormat'
import { getObjectDisplayTitle, isObjectType } from '../../lib/objectTypeDefinitions'

interface ObjectMetaDetailPanelProps {
  object?: Record<string, unknown>
  type: 'scripture' | 'tag' | 'habit'
  flatTop?: boolean
  onNavigateToObject?: (target: ResolvedObjectRef, options?: { forceNewTab?: boolean }) => void | Promise<void>
  /** Called after a habit is deleted, so the surrounding view can close and refresh. */
  onDeleted?: () => void | Promise<void>
}

function toTarget(row: Record<string, unknown>): ResolvedObjectRef | null {
  const id = String(row.id ?? '').trim()
  const type = String(row.type ?? '').trim() as ResolvedObjectRef['type']
  const syncPath = String(row.syncPath ?? '').trim()
  if (!id || !type) return null
  return { id, type, syncPath }
}

function relationLabel(row: Record<string, unknown>): string {
  const type = String(row.type ?? '').trim()
  if (isObjectType(type)) return getObjectDisplayTitle(type, row)
  const fallback = String(row.title ?? row.name ?? row.text ?? row.date ?? row.id ?? '').trim()
  return fallback || 'Object'
}

export default function ObjectMetaDetailPanel({ object, type, flatTop = false, onNavigateToObject, onDeleted }: ObjectMetaDetailPanelProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const header = type === 'scripture' ? 'Scripture' : type === 'habit' ? 'Habit' : 'Tag'
  const title = useMemo(() => {
    return getObjectDisplayTitle(type, object)
  }, [object, type])

  const subtitle = useMemo(() => {
    if (type === 'habit') {
      const stats = (object?.stats ?? {}) as Record<string, unknown>
      const habit = {
        name: String(object?.name ?? ''),
        targetIntervalDays: (object?.targetIntervalDays ?? null) as number | null,
        stats: stats as never,
      }
      const parts = [describeHabitRecency(habit)]
      const cadence = describeHabitCadence(habit)
      if (cadence) parts.push(cadence)
      const count = Number(stats.entryCount ?? 0)
      parts.push(`${count} occurrence${count === 1 ? '' : 's'}`)
      return parts.join(' · ')
    }
    if (type === 'scripture') {
      const noteCount = Number(object?.linkedNotes ? (object?.linkedNotes as unknown[]).length : 0)
      return noteCount === 1 ? '1 linked note' : `${noteCount} linked notes`
    }
    const objectCount = Number(object?.objects ? (object?.objects as unknown[]).length : 0)
    return objectCount === 1 ? '1 tagged object' : `${objectCount} tagged objects`
  }, [object, type])

  /** Occurrences newest-first, each with the interval since the previous one. */
  const habitLog = useMemo(() => {
    if (type !== 'habit') return []
    const entries = (Array.isArray(object?.entries) ? object.entries : []) as Array<Record<string, unknown>>
    const sorted = entries
      .map((entry) => ({ date: String(entry.date ?? ''), note: String(entry.note ?? '') }))
      .filter((entry) => entry.date)
      .sort((a, b) => (a.date < b.date ? 1 : -1))
    return sorted.map((entry, index) => {
      const previous = sorted[index + 1]
      const gap = previous
        ? Math.round((Date.parse(`${entry.date}T00:00:00Z`) - Date.parse(`${previous.date}T00:00:00Z`)) / 86_400_000)
        : null
      return { ...entry, gap }
    })
  }, [object, type])

  const relations = useMemo(() => {
    if (type === 'scripture' && Array.isArray(object?.linkedNotes)) {
      return object.linkedNotes as Array<Record<string, unknown>>
    }
    if (type === 'tag' && Array.isArray(object?.objects)) {
      return object.objects as Array<Record<string, unknown>>
    }
    return []
  }, [object, type])

  const habitEntryCount = Number((object?.stats as Record<string, unknown> | undefined)?.entryCount ?? 0)

  const handleDelete = async () => {
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteObject('habit', String(object?.id ?? ''))
      setConfirmingDelete(false)
      await onDeleted?.()
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      className={flatTop ? 'flex min-h-0 flex-1 overflow-hidden bg-transparent' : 'flex min-h-0 flex-1 overflow-hidden rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] p-6'}
    >
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <div className={flatTop ? 'shrink-0 px-6 pb-2.5 pt-6' : 'shrink-0 pb-2.5'}>
          <p className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
            {header}
          </p>
          <h2 className={type === 'tag' ? 'ui-tag-text mt-1 text-xl font-bold leading-[1.2] text-[var(--color-text-primary)]' : 'mt-1 text-xl font-bold leading-[1.2] text-[var(--color-text-primary)]'}>
            {title}
          </h2>
          <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
            {subtitle}
          </p>
          {type === 'habit' && String(object?.id ?? '').trim() && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="mt-4"
              onClick={() => { setDeleteError(null); setConfirmingDelete(true) }}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete habit
            </Button>
          )}
          {type === 'scripture' && String(object?.passageUrl ?? '').trim() && (
            <a
              href={String(object?.passageUrl)}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-block text-sm text-[var(--color-accent-link)] underline"
            >
              Open passage
            </a>
          )}
        </div>

        <div className={flatTop ? 'min-h-0 flex-1 overflow-auto border-t border-[var(--color-border-subtle)] px-6 pb-6 pt-6' : 'min-h-0 flex-1 overflow-auto border-t border-[var(--color-border-subtle)] pt-6'}>
          <p className="mb-3 block text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
            {type === 'scripture' ? 'Linked Notes' : type === 'habit' ? 'Log' : 'Tagged Objects'}
          </p>
          {type === 'habit' ? (
            habitLog.length === 0 ? (
              <p className="text-xs italic text-[var(--color-text-disabled)]">Nothing logged yet</p>
            ) : (
              <ul className="divide-y divide-[var(--color-border-subtle)]">
                {habitLog.map((row) => (
                  <li key={row.date} className="flex items-baseline justify-between gap-3 py-1.5">
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
            )
          ) : (
          <div className="space-y-2">
            {relations.length === 0 ? (
              <p className="text-xs italic text-[var(--color-text-disabled)]">
                None
              </p>
            ) : (
              relations.map((row) => {
                const target = toTarget(row)
                const primaryLabel = relationLabel(row)
                const secondaryLabel = String(row.type ?? '').trim().replace(/-/g, ' ')
                return (
                  <Button
                    key={`${String(row.type)}:${String(row.id)}`}
                    onClick={(event) => {
                      if (!target || !onNavigateToObject) return
                      void onNavigateToObject(target, { forceNewTab: event.metaKey || event.ctrlKey })
                    }}
                    disabled={Boolean(!target || !onNavigateToObject)}
                    variant="ghost"
                    className="h-auto w-full justify-start rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-control)] px-3 py-2 text-left"
                  >
                    <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                      <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                        {primaryLabel}
                      </span>
                      <span className="truncate text-xs uppercase tracking-[0.08em] text-[var(--color-text-disabled)]">
                        {secondaryLabel || 'object'}
                      </span>
                    </span>
                  </Button>
                )
              })
            )}
          </div>
          )}
        </div>
      </div>

      {confirmingDelete && (
        <Dialog open onOpenChange={(open) => { if (!open && !deleting) setConfirmingDelete(false) }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete this habit?</DialogTitle>
              <DialogDescription>
                {`“${String(object?.name ?? 'This habit')}” and its ${habitEntryCount} logged occurrence${habitEntryCount === 1 ? '' : 's'} will be removed from the database and its Markdown file deleted from the sync folder. This cannot be undone — to stop practising something while keeping its history, retire it instead.`}
              </DialogDescription>
            </DialogHeader>
            {deleteError && <Alert variant="destructive" className="py-2 text-xs">{deleteError}</Alert>}
            <DialogFooter>
              <Button variant="outline" size="sm" disabled={deleting} onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleting}
                onClick={() => { void handleDelete() }}
              >
                {deleting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
                {deleting ? 'Deleting…' : 'Delete permanently'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

