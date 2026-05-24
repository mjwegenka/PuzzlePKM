import React, { useState, useEffect, useCallback } from 'react'
import {
  Box,
  Stack,
  Paper,
  Typography,
  Button,
  CircularProgress,
  IconButton,
  Menu,
  MenuItem,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import CloseIcon from '@mui/icons-material/Close'
import ObjectEditor from './ObjectEditor'
import EditorErrorBoundary from './EditorErrorBoundary'
import { listDailyNoteMeta, listTopicNoteMeta, listHabitMeta, listFileMeta, getObject } from '../lib/cliService'
import type { ResolvedObjectRef } from '../lib/cliService'
import { getTodayDate } from '../lib/dateUtils'
import { getObjectColor } from '../lib/objectColors'

function normalizePathForLookup(path?: string): string {
  return String(path ?? '')
    .trim()
    .replace(/[?#].*$/, '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .toLowerCase()
}

type CalObjectType = 'daily-note' | 'topic-note' | 'habit' | 'project' | 'ref-material'

const CAL_OBJECT_TYPES = new Set<string>(['daily-note', 'topic-note', 'habit', 'project', 'ref-material'])
function isCalObjectType(t: string): t is CalObjectType {
  return CAL_OBJECT_TYPES.has(t)
}

interface CalEvent {
  id: string
  date: string
  label: string
  type: CalObjectType
}

interface CalendarPageProps {
  onOpenObjectTab?: (target: { id: string; type: CalObjectType; forceNewTab?: boolean }) => void | Promise<void>
}

const TYPE_COLORS: Record<CalObjectType, { bg: string; border: string; text: string }> = {
  'daily-note':   getObjectColor('daily-note'),
  'topic-note':   getObjectColor('topic-note'),
  'habit':        getObjectColor('habit'),
  'project':      getObjectColor('project'),
  'ref-material': getObjectColor('ref-material'),
}

const TYPE_LABELS: Record<CalObjectType, string> = {
  'daily-note': 'Daily Note',
  'topic-note': 'Topic Note',
  'habit': 'Habit',
  'project': 'Project',
  'ref-material': 'Reference Material',
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function CalendarPage({ onOpenObjectTab }: CalendarPageProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [events, setEvents] = useState<CalEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string>(getTodayDate())
  const [selectedObject, setSelectedObject] = useState<Record<string, unknown> | undefined>()
  const [selectedType, setSelectedType] = useState<CalObjectType>('daily-note')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [showConfirmClose, setShowConfirmClose] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number; date: string } | null>(null)

  const yr = currentMonth.getFullYear()
  const mo = currentMonth.getMonth()
  const yearOptions = Array.from({ length: 121 }, (_, index) => yr - 60 + index)

  const loadEvents = useCallback(async () => {
    setLoading(true)
    try {
      const [dailyRes, topicRes, habitRes, projectRes] = await Promise.allSettled([
        listDailyNoteMeta(),
        listTopicNoteMeta(),
        listHabitMeta(),
        listFileMeta(),
      ])
      const evts: CalEvent[] = []
      if (dailyRes.status === 'fulfilled') {
        for (const n of dailyRes.value) {
          if (n.date) evts.push({ id: n.id, date: n.date, label: n.date, type: 'daily-note' })
        }
      }
      if (topicRes.status === 'fulfilled') {
        for (const n of topicRes.value) {
          const d = (n as Record<string, unknown>).date as string | undefined
          if (d) evts.push({ id: n.id, date: d, label: n.title || d, type: 'topic-note' })
        }
      }
      if (habitRes.status === 'fulfilled') {
        for (const h of habitRes.value) {
          if (h.date) evts.push({ id: h.id, date: h.date, label: h.text || 'Habit', type: 'habit' })
        }
      }
      if (projectRes.status === 'fulfilled') {
        for (const p of projectRes.value) {
          if (p.type === 'project' && p.startDate) {
            evts.push({ id: p.id, date: p.startDate, label: p.name, type: 'project' })
          }
        }
      }
      setEvents(evts)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadEvents()
  }, [loadEvents])

  const daysInMonth = new Date(yr, mo + 1, 0).getDate()
  const firstDayOfWeek = new Date(yr, mo, 1).getDay()
  const fmt = (y: number, m: number, d: number) =>
    `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

  const cells: (number | null)[] = []
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const eventsForDate = (date: string) => events.filter((e) => e.date === date)

  const isToday = (day: number) => {
    const t = new Date()
    return day === t.getDate() && mo === t.getMonth() && yr === t.getFullYear()
  }

  const openEvent = useCallback(async (evt: CalEvent) => {
    if (onOpenObjectTab) {
      setSelectedDate(evt.date)
      await Promise.resolve(onOpenObjectTab({ id: evt.id, type: evt.type, forceNewTab: true }))
      return
    }

    setSelectedDate(evt.date)
    setSelectedType(evt.type)
    try {
      const full = await getObject(evt.type, evt.id)
      setSelectedObject({ ...full, type: evt.type })
    } catch {
      setSelectedObject(
        evt.type === 'habit'
          ? { id: evt.id, date: evt.date, type: 'habit', text: '', tags: [] }
          : { id: evt.id, date: evt.date, type: evt.type, contentMarkdown: '', tags: [] },
      )
    }
  }, [onOpenObjectTab])

  const handleDayClick = useCallback(
    async (day: number) => {
      const date = fmt(yr, mo, day)
      setSelectedDate(date)
      const dayEvts = eventsForDate(date)
      if (dayEvts.length === 0) {
        if (onOpenObjectTab) return
        setSelectedType('daily-note')
        setSelectedObject({ date, type: 'daily-note', contentMarkdown: '', tags: [], linkedObjectIds: [] })
      } else if (dayEvts.length === 1) {
        await openEvent(dayEvts[0])
      } else if (onOpenObjectTab) {
        const dailyFirst = dayEvts.find((evt) => evt.type === 'daily-note') ?? dayEvts[0]
        await openEvent(dailyFirst)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [yr, mo, events, onOpenObjectTab, openEvent],
  )

  const handleSave = useCallback(
    async () => {
      await loadEvents()
      setHasUnsavedChanges(false)
      setSelectedObject(undefined)
    },
    [loadEvents],
  )

  const handleCloseModal = useCallback(() => {
    if (hasUnsavedChanges) {
      setShowConfirmClose(true)
    } else {
      setSelectedObject(undefined)
    }
  }, [hasUnsavedChanges])

  const startCreateForDate = useCallback((date: string, type: CalObjectType) => {
    setSelectedDate(date)
    setSelectedType(type)
    if (type === 'daily-note') {
      setSelectedObject({ date, type: 'daily-note', contentMarkdown: '', tags: [], linkedObjectIds: [] })
      return
    }
    if (type === 'topic-note') {
      setSelectedObject({ title: '', date, type: 'topic-note', contentMarkdown: '', tags: [], linkedObjectIds: [] })
      return
    }
    if (type === 'habit') {
      setSelectedObject({ date, type: 'habit', text: '', tags: [] })
      return
    }
  }, [])

  const handleConfirmClose = () => {
    setShowConfirmClose(false)
    setHasUnsavedChanges(false)
    setSelectedObject(undefined)
  }

  const handleNavigateToObject = useCallback(async (target: ResolvedObjectRef) => {
    try {
      const full = await getObject(target.type, target.id)
      if (full && typeof full === 'object') {
        if (!isCalObjectType(target.type)) return
        setSelectedType(target.type)
        setSelectedObject({ ...full, type: target.type })
        setHasUnsavedChanges(false)
        return
      }
    } catch {
      // Keep current object open and try a metadata fallback below.
    }

    if (target.type === 'habit') {
      const habitsMeta = await listHabitMeta()
      const targetPath = normalizePathForLookup(target.syncPath ?? target.syncPath)
      const fallback = habitsMeta.find((item) => item.id === target.id)
        ?? habitsMeta.find((item) => normalizePathForLookup(item.syncPath ?? item.syncPath) === targetPath)
      if (fallback) {
        try {
          const fullFallback = await getObject('habit', fallback.id)
          setSelectedType('habit')
          setSelectedObject({ ...fullFallback, type: 'habit' })
          setHasUnsavedChanges(false)
          return
        } catch {
          // Fall through to metadata-only fallback.
        }
        setSelectedType('habit')
        setSelectedObject({ ...fallback, type: 'habit' })
        setHasUnsavedChanges(false)
      }
    }
  }, [])

  return (
    <Stack direction="row" spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
      <Paper
        sx={{
          flex: 1,
          minWidth: 0,
          p: 2,
          bgcolor: 'surface.elevated',
          border: '1px solid',
          borderColor: 'border.subtle',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Month header */}
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5, flexShrink: 0 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary' }}>
            {currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
          </Typography>
            <Stack direction="row" spacing={0.75} alignItems="center">
              <TextField
                select
                size="small"
                value={mo}
                aria-label="Select month"
                onChange={(event) => {
                  setCurrentMonth(new Date(yr, Number(event.target.value), 1))
                }}
                sx={{
                  width: 90,
                  '& .MuiOutlinedInput-root': {
                    minHeight: 32,
                    fontSize: '12px',
                    bgcolor: 'surface.sunken',
                    color: 'text.secondary',
                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'border.strong' },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'border.strong' },
                  },
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'border.subtle' },
                }}
              >
                {MONTH_LABELS.map((label, monthIndex) => (
                  <MenuItem key={label} value={monthIndex}>{label}</MenuItem>
                ))}
              </TextField>
              <TextField
                select
                size="small"
                value={yr}
                aria-label="Select year"
                onChange={(event) => {
                  const parsedYear = Number.parseInt(String(event.target.value), 10)
                  if (!Number.isFinite(parsedYear)) return
                  setCurrentMonth(new Date(parsedYear, mo, 1))
                }}
                sx={{
                  width: 88,
                  '& .MuiOutlinedInput-root': {
                    minHeight: 32,
                    fontSize: '12px',
                    bgcolor: 'surface.sunken',
                    color: 'text.secondary',
                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'border.strong' },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'border.strong' },
                  },
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'border.subtle' },
                }}
              >
                {yearOptions.map((year) => (
                  <MenuItem key={year} value={year}>{year}</MenuItem>
                ))}
              </TextField>
            {loading && <CircularProgress size={14} sx={{ mr: 0.5, color: 'text.secondary' }} />}
            <IconButton size="small" onClick={() => setCurrentMonth(new Date(yr, mo - 1, 1))} sx={{ color: 'text.secondary' }}>
              <ChevronLeftIcon fontSize="small" sx={{ fontSize: 18 }} />
            </IconButton>
            <Button size="small" variant="outlined" onClick={() => setCurrentMonth(new Date())} sx={{ borderColor: 'border.subtle', color: 'text.primary', bgcolor: 'surface.sunken', '&:hover': { borderColor: 'border.strong', bgcolor: 'surface.elevated' } }}>
              Today
            </Button>
            <IconButton size="small" onClick={() => setCurrentMonth(new Date(yr, mo + 1, 1))} sx={{ color: 'text.secondary' }}>
              <ChevronRightIcon fontSize="small" sx={{ fontSize: 18 }} />
            </IconButton>
          </Stack>
        </Stack>

        {/* Legend */}
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ mb: 1, flexShrink: 0 }}>
          {(Object.entries(TYPE_COLORS) as [CalObjectType, (typeof TYPE_COLORS)[CalObjectType]][]).map(
            ([type, colors]) => (
              <Stack key={type} direction="row" spacing={0.5} alignItems="center">
                <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: colors.bg, border: `1px solid ${colors.border}` }} />
                <Typography variant="caption" sx={{ color: colors.text, fontSize: '10px' }}>
                  {TYPE_LABELS[type]}
                </Typography>
              </Stack>
            ),
          )}
        </Stack>

        {/* Day-of-week headers */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '1px', mb: 0.5, flexShrink: 0 }}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <Typography key={d} variant="caption" sx={{ textAlign: 'center', fontWeight: 700, color: 'text.secondary', py: 0.5, fontSize: '11px' }}>
              {d}
            </Typography>
          ))}
        </Box>

        {/* Day cells - fixed width grid */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '2px', flex: 1, overflow: 'auto', alignContent: 'start' }}>
          {cells.map((day, idx) => {
            if (!day) return <Box key={`empty-${idx}`} sx={{ minHeight: 72, bgcolor: 'transparent', borderRadius: 1 }} />

            const date = fmt(yr, mo, day)
            const dayEvts = eventsForDate(date)
            const today = isToday(day)
            const selected = date === selectedDate

            return (
              <Box
                key={date}
                onClick={() => handleDayClick(day)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setContextMenu({ mouseX: event.clientX + 2, mouseY: event.clientY - 6, date })
                }}
                sx={{
                  minHeight: 72,
                  minWidth: 0,
                  p: '4px 6px',
                  borderRadius: 1,
                  border: '1px solid',
                  borderColor: selected ? 'border.strong' : 'border.subtle',
                  bgcolor: selected
                    ? (theme) => alpha(theme.palette.accent.selected, 0.12)
                    : today
                      ? (theme) => alpha(theme.palette.accent.selected, 0.08)
                      : 'surface.app',
                  cursor: 'pointer',
                  transition: 'background 0.12s',
                  '&:hover': { bgcolor: 'surface.sunken', borderColor: 'border.strong' },
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                }}
              >
                <Typography variant="caption" sx={{ fontWeight: today ? 800 : 500, color: today || selected ? 'accent.selected' : 'text.primary', fontSize: '12px', lineHeight: 1.3 }}>
                  {day}
                </Typography>
                {dayEvts.slice(0, 3).map((evt) => {
                  const colors = TYPE_COLORS[evt.type]
                  return (
                    <Box
                      key={evt.id}
                      onClick={(e) => { e.stopPropagation(); openEvent(evt) }}
                      sx={{ bgcolor: colors.bg, border: `1px solid ${colors.border}`, borderRadius: '3px', px: '4px', py: '1px', cursor: 'pointer', '&:hover': { filter: 'brightness(1.35)' }, overflow: 'hidden' }}
                    >
                      <Typography variant="caption" sx={{ color: colors.text, fontSize: '10px', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {evt.type === 'daily-note' ? '📓 Daily'
                          : evt.type === 'habit' ? `🔁 ${evt.label}`
                          : evt.type === 'project' ? `📁 ${evt.label}`
                          : `📝 ${evt.label}`}
                      </Typography>
                    </Box>
                  )
                })}
                {dayEvts.length > 3 && (
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '10px' }}>
                    +{dayEvts.length - 3} more
                  </Typography>
                )}
              </Box>
            )
          })}
        </Box>
      </Paper>

      {selectedObject && (
        <Paper sx={{ width: 520, minWidth: 400, bgcolor: 'surface.elevated', border: '1px solid', borderColor: 'border.subtle', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'border.subtle' }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {selectedType === 'daily-note' ? 'Daily Note'
                : selectedType === 'habit' ? 'Habit'
                : selectedType === 'project' ? 'Project'
                : selectedType === 'ref-material' ? 'Reference Material'
                : 'Topic Note'}
            </Typography>
            <IconButton size="small" onClick={handleCloseModal} sx={{ color: 'text.secondary' }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
          <Box sx={{ p: 1.5, flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
            <EditorErrorBoundary>
              <ObjectEditor
                object={selectedObject}
                type={selectedType}
                onSave={handleSave}
                onDirty={setHasUnsavedChanges}
                onNavigateToObject={handleNavigateToObject}
              />
            </EditorErrorBoundary>
          </Box>
        </Paper>
      )}

      <Menu
        open={Boolean(contextMenu)}
        onClose={() => setContextMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
        slotProps={{
          paper: {
            sx: {
              bgcolor: 'surface.elevated',
              border: '1px solid',
              borderColor: 'border.subtle',
            },
          },
          list: {
            dense: true,
          },
        }}
      >
        <MenuItem
          onClick={() => {
            if (contextMenu) startCreateForDate(contextMenu.date, 'daily-note')
            setContextMenu(null)
          }}
        >
          New Daily Note
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (contextMenu) startCreateForDate(contextMenu.date, 'topic-note')
            setContextMenu(null)
          }}
        >
          New Topic Note
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (contextMenu) startCreateForDate(contextMenu.date, 'habit')
            setContextMenu(null)
          }}
        >
          New Habit
        </MenuItem>
      </Menu>

       {/* Confirmation Dialog for unsaved changes */}
       <Dialog
         open={showConfirmClose}
         onClose={() => setShowConfirmClose(false)}
       >
         <DialogTitle>Unsaved Changes</DialogTitle>
         <DialogContent>
           <Typography>
             You have unsaved changes. Are you sure you want to close without saving?
           </Typography>
         </DialogContent>
         <DialogActions>
           <Button onClick={() => setShowConfirmClose(false)}>Cancel</Button>
           <Button onClick={handleConfirmClose} variant="contained" color="error">
             Discard Changes
           </Button>
         </DialogActions>
       </Dialog>
    </Stack>
  )
}
