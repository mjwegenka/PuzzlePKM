import React, { useMemo } from 'react'
import type { ResolvedObjectRef } from '../../lib/cliService'
import { formatDatePretty } from '../../lib/dateUtils'
import { Button } from '../ui/button'

interface ObjectMetaDetailPanelProps {
  object?: Record<string, unknown>
  type: 'scripture' | 'tag'
  flatTop?: boolean
  onNavigateToObject?: (target: ResolvedObjectRef, options?: { forceNewTab?: boolean }) => void | Promise<void>
}

function toTarget(row: Record<string, unknown>): ResolvedObjectRef | null {
  const id = String(row.id ?? '').trim()
  const type = String(row.type ?? '').trim() as ResolvedObjectRef['type']
  const syncPath = String(row.syncPath ?? '').trim()
  if (!id || !type) return null
  return { id, type, syncPath }
}

function relationLabel(row: Record<string, unknown>): string {
  const title = String(row.title ?? '').trim()
  const name = String(row.name ?? '').trim()
  const text = String(row.text ?? '').trim()
  const date = String(row.date ?? '').trim()
  if (title) return title
  if (name) return name
  if (text) return text
  if (date) return date
  return String(row.id ?? '')
}

export default function ObjectMetaDetailPanel({ object, type, flatTop = false, onNavigateToObject }: ObjectMetaDetailPanelProps) {
  const header = type === 'scripture' ? 'Scripture' : 'Tag'
  const title = useMemo(() => {
    if (type === 'scripture') return String(object?.reference ?? '').trim() || 'Scripture'
    const displayName = String(object?.displayName ?? '').trim()
    const fallbackName = String(object?.name ?? '').trim()
    return displayName ? `#${displayName}` : fallbackName ? `#${fallbackName}` : '#Tag'
  }, [object, type])

  const subtitle = useMemo(() => {
    if (type === 'scripture') {
      const noteCount = Number(object?.linkedNotes ? (object?.linkedNotes as unknown[]).length : 0)
      return noteCount === 1 ? '1 linked note' : `${noteCount} linked notes`
    }
    const objectCount = Number(object?.objects ? (object?.objects as unknown[]).length : 0)
    return objectCount === 1 ? '1 tagged object' : `${objectCount} tagged objects`
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
            {type === 'scripture' ? 'Linked Notes' : 'Tagged Objects'}
          </p>
          <div className="space-y-2">
            {relations.length === 0 ? (
              <p className="text-xs italic text-[var(--color-text-disabled)]">
                None
              </p>
            ) : (
              relations.map((row) => {
                const target = toTarget(row)
                const label = relationLabel(row)
                const date = String(row.date ?? '').trim()
                const primaryLabel = date && row.type === 'daily-note' ? formatDatePretty(date) : label
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
        </div>
      </div>
    </div>
  )
}

