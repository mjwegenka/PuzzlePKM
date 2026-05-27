import React, { useMemo } from 'react'
import { Box, Paper, Stack, Typography } from '@mui/material'
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
    <Paper
      sx={{
        p: flatTop ? 0 : 3,
        bgcolor: flatTop ? 'transparent' : 'surface.elevated',
        border: flatTop ? 'none' : '1px solid',
        borderColor: 'border.subtle',
        borderTopLeftRadius: flatTop ? 0 : undefined,
        borderTopRightRadius: flatTop ? 0 : undefined,
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <Stack spacing={0} sx={{ minHeight: 0, height: '100%' }}>
        <Box sx={{ px: flatTop ? 3 : 0, pt: flatTop ? 3 : 0, pb: 2.5, flexShrink: 0 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: '10px' }}>
            {header}
          </Typography>
          <Typography variant="h4" sx={{ fontSize: '1.8rem', fontWeight: 700, color: 'text.primary', lineHeight: 1.2, mt: 0.5 }}>
            {title}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.75 }}>
            {subtitle}
          </Typography>
          {type === 'scripture' && String(object?.passageUrl ?? '').trim() && (
            <Typography
              component="a"
              href={String(object?.passageUrl)}
              target="_blank"
              rel="noreferrer"
              sx={{ color: 'accent.link', textDecoration: 'underline', mt: 1, display: 'inline-block' }}
            >
              Open passage
            </Typography>
          )}
        </Box>

        <Box sx={{ borderTop: '1px solid', borderColor: 'border.subtle', px: flatTop ? 3 : 0, pt: 2.5, pb: flatTop ? 3 : 0, minHeight: 0, flex: 1, overflow: 'auto' }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: '10px', display: 'block', mb: 1.25 }}>
            {type === 'scripture' ? 'Linked Notes' : 'Tagged Objects'}
          </Typography>
          <Stack spacing={1}>
            {relations.length === 0 ? (
              <Typography variant="caption" sx={{ color: 'text.disabled', fontStyle: 'italic' }}>
                None
              </Typography>
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
                      <span className="truncate text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-disabled)]">
                        {secondaryLabel || 'object'}
                      </span>
                    </span>
                  </Button>
                )
              })
            )}
          </Stack>
        </Box>
      </Stack>
    </Paper>
  )
}

