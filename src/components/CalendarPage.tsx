import React, { useState, useEffect, useCallback } from 'react'
import {
  Box,
  Stack,
  Paper,
  Typography,
  Button,
  CircularProgress,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton as MuiIconButton,
} from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import CloseIcon from '@mui/icons-material/Close'
import ObjectEditor from './ObjectEditor'
import EditorErrorBoundary from './EditorErrorBoundary'
import { listDailyNoteMeta, listTopicNoteMeta, listHabitMeta, listFileMeta, getObject } from '../lib/cliService'
import type { ResolvedObjectRef } from '../lib/cliService'
import { getTodayDate } from '../lib/dateUtils'

function normalizePathForLookup(path?: string): string {
  return String(path ?? '')
    .trim()
    .replace(/[?#].*$/, '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .toLowerCase()
}

type CalObjectType = 'daily-note' | 'topic-note' | 'habit' | 'project' | 'ref-material'

interface CalEvent {
  id: string
  date: string
  label: string
  type: CalObjectType
}

const TYPE_COLORS: Record<CalObjectType, { bg: string; border: string; text: string }> = {
  'daily-note': { bg: 'rgba(26,138,181,0.22)', border: 'rgba(26,138,181,0.55)', text: '#7dbad6' },
  'topic-note': { bg: 'rgba(72,178,120,0.18)', border: 'rgba(72,178,120,0.45)', text: '#7dcfaa' },
  'habit':      { bg: 'rgba(200,131,42,0.18)',  border: 'rgba(200,131,42,0.45)',  text: '#e8a84a' },
  'project':    { bg: 'rgba(156,109,212,0.18)', border: 'rgba(156,109,212,0.45)', text: '#c49be8' },
  'ref-material': { bg: 'rgba(109,176,212,0.18)', border: 'rgba(109,176,212,0.45)', text: '#9ed8ef' },
}

const TYPE_LABELS: Record<CalObjectType, string> = {
  'daily-note': 'Daily Note',
  'topic-note': 'Topic Note',
  'habit': 'Habit',
  'project': 'Project',
  'ref-material': 'Reference Material',
}

export default function CalendarPage() {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [events, setEvents] = useState<CalEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string>(getTodayDate())
  const [selectedObject, setSelectedObject] = useState<Record<string, unknown> | undefined>()
  const [selectedType, setSelectedType] = useState<CalObjectType>('daily-note')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [showConfirmClose, setShowConfirmClose] = useState(false)

  const yr = currentMonth.getFullYear()
  const mo = currentMonth.getMonth()

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
  }, [])

  const handleDayClick = useCallback(
    async (day: number) => {
      const date = fmt(yr, mo, day)
      setSelectedDate(date)
      const dayEvts = eventsForDate(date)
      if (dayEvts.length === 0) {
        setSelectedType('daily-note')
        setSelectedObject({ date, type: 'daily-note', contentMarkdown: '', tags: [], linkedObjectIds: [] })
      } else if (dayEvts.length === 1) {
        await openEvent(dayEvts[0])
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [yr, mo, events, openEvent],
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

  const handleConfirmClose = () => {
    setShowConfirmClose(false)
    setHasUnsavedChanges(false)
    setSelectedObject(undefined)
  }

  const handleNavigateToObject = useCallback(async (target: ResolvedObjectRef) => {
    try {
      const full = await getObject(target.type, target.id)
      if (full && typeof full === 'object') {
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
      const targetPath = normalizePathForLookup(target.dropboxPath)
      const fallback = habitsMeta.find((item) => item.id === target.id)
        ?? habitsMeta.find((item) => normalizePathForLookup(item.dropboxPath) === targetPath)
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
    <>
      <Paper
        sx={{
          flex: 1,
          minWidth: 0,
          p: 2,
          bgcolor: '#0e2038',
          border: '1px solid #1c3558',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Month header */}
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5, flexShrink: 0 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            {currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
          </Typography>
          <Stack direction="row" spacing={0.5} alignItems="center">
            {loading && <CircularProgress size={14} sx={{ mr: 0.5 }} />}
            <IconButton size="small" onClick={() => setCurrentMonth(new Date(yr, mo - 1, 1))}>
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
            <Button size="small" variant="outlined" onClick={() => setCurrentMonth(new Date())}>
              Today
            </Button>
            <IconButton size="small" onClick={() => setCurrentMonth(new Date(yr, mo + 1, 1))}>
              <ChevronRightIcon fontSize="small" />
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
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '1px', mb: 0.5, flexShrink: 0 }}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <Typography key={d} variant="caption" sx={{ textAlign: 'center', fontWeight: 700, color: '#7dbad6', py: 0.5, fontSize: '11px' }}>
              {d}
            </Typography>
          ))}
        </Box>

        {/* Day cells - fixed width grid */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', flex: 1, overflow: 'auto', alignContent: 'start' }}>
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
                sx={{
                  minHeight: 72,
                  p: '4px 6px',
                  borderRadius: 1,
                  border: '1px solid',
                  borderColor: selected ? '#1a8ab5' : '#1c3558',
                  bgcolor: today ? 'rgba(26,138,181,0.09)' : selected ? 'rgba(26,138,181,0.05)' : 'rgba(255,255,255,0.01)',
                  cursor: 'pointer',
                  transition: 'background 0.12s',
                  '&:hover': { bgcolor: 'rgba(26,138,181,0.13)' },
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                }}
              >
                <Typography variant="caption" sx={{ fontWeight: today ? 800 : 400, color: today ? '#1a8ab5' : '#e4f0fb', fontSize: '12px', lineHeight: 1.3 }}>
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
                  <Typography variant="caption" sx={{ color: '#7dbad6', fontSize: '10px' }}>
                    +{dayEvts.length - 3} more
                  </Typography>
                )}
              </Box>
            )
          })}
        </Box>
      </Paper>

       {/* Modal Editor Dialog */}
       <Dialog
         open={!!selectedObject}
         onClose={handleCloseModal}
         maxWidth={false}
         fullWidth
         PaperProps={{
           sx: {
             bgcolor: '#0e2038',
             border: '1px solid #1c3558',
             borderRadius: '8px',
             width: 'calc(100vw - 32px)',
             maxWidth: 'none',
             height: 'calc(100vh - 32px)',
             maxHeight: 'none',
             display: 'flex',
             flexDirection: 'column',
           },
         }}
       >
         <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pb: 1, flexShrink: 0 }}>
           <Typography variant="h6" sx={{ fontWeight: 700 }}>
             {selectedType === 'daily-note' ? '📓 Daily Note'
               : selectedType === 'habit' ? '🔁 Habit'
               : selectedType === 'project' ? '📁 Project'
               : selectedType === 'ref-material' ? '📚 Reference Material'
               : '📝 Topic Note'}
           </Typography>
           <MuiIconButton size="small" onClick={handleCloseModal} sx={{ ml: 'auto' }}>
             <CloseIcon fontSize="small" />
           </MuiIconButton>
         </DialogTitle>
         <DialogContent dividers sx={{ p: 2, bgcolor: '#0e2038', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
           {selectedObject ? (
             <EditorErrorBoundary>
               <ObjectEditor
                 object={selectedObject}
                 type={selectedType}
                 onSave={handleSave}
                 onDirty={setHasUnsavedChanges}
                 onNavigateToObject={handleNavigateToObject}
               />
             </EditorErrorBoundary>
           ) : null}
         </DialogContent>
       </Dialog>

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
    </>
  )
}
