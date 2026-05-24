import React, { useMemo } from 'react'
import { Box, Chip, Paper, Stack, Typography } from '@mui/material'
import type { ResolvedObjectRef } from '../lib/cliService'
import { formatDatePretty } from '../lib/dateUtils'

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
        p: 3,
        bgcolor: 'surface.elevated',
        border: flatTop ? 'none' : '1px solid',
        borderColor: 'border.subtle',
        borderTopLeftRadius: flatTop ? 0 : undefined,
        borderTopRightRadius: flatTop ? 0 : undefined,
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
      }}
    >
      <Stack spacing={2}>
        <Box>
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

        <Box sx={{ borderTop: '1px solid', borderColor: 'border.subtle', pt: 2 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: '10px', display: 'block', mb: 0.75 }}>
            {type === 'scripture' ? 'Linked Notes' : 'Tagged Objects'}
          </Typography>
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
            {relations.length === 0 ? (
              <Typography variant="caption" sx={{ color: 'text.disabled', fontStyle: 'italic' }}>
                None
              </Typography>
            ) : (
              relations.map((row) => {
                const target = toTarget(row)
                const label = relationLabel(row)
                const date = String(row.date ?? '').trim()
                const chipLabel = date && row.type === 'daily-note' ? formatDatePretty(date) : label
                return (
                  <Chip
                    key={`${String(row.type)}:${String(row.id)}`}
                    label={chipLabel}
                    size="small"
                    clickable={Boolean(target && onNavigateToObject)}
                    onClick={(event) => {
                      if (!target || !onNavigateToObject) return
                      void onNavigateToObject(target, { forceNewTab: event.metaKey || event.ctrlKey })
                    }}
                    sx={{
                      bgcolor: 'action.selected',
                      border: '1px solid',
                      borderColor: 'accent.selected',
                      color: 'text.secondary',
                      height: 22,
                    }}
                  />
                )
              })
            )}
          </Stack>
        </Box>
      </Stack>
    </Paper>
  )
}

