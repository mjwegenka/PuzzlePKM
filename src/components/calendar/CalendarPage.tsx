import React, { useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react'
import ObjectEditor from '../objects/ObjectEditor'
import EditorErrorBoundary from '../common/EditorErrorBoundary'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { listDailyNoteMeta, listTopicNoteMeta, listHabitMeta, listFileMeta, getObject } from '../../lib/cliService'
import type { ResolvedObjectRef } from '../../lib/cliService'
import { getTodayDate } from '../../lib/dateUtils'
import { getObjectColor } from '../../lib/objectColors'

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
    <div className="flex min-h-0 flex-1 gap-1.5">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] p-2">
        {/* Month header */}
        <div className="mb-1.5 flex shrink-0 items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--color-text-primary)]">
            {currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
          </h2>
          <div className="flex items-center gap-1">
            <Select
              value={String(mo)}
              onValueChange={(value) => {
                setCurrentMonth(new Date(yr, Number(value), 1))
              }}
            >
              <SelectTrigger aria-label="Select month" className="h-8 w-[90px] border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] text-xs text-[var(--color-text-secondary)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTH_LABELS.map((label, monthIndex) => (
                  <SelectItem key={label} value={String(monthIndex)}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={String(yr)}
              onValueChange={(value) => {
                const parsedYear = Number.parseInt(String(value), 10)
                if (!Number.isFinite(parsedYear)) return
                setCurrentMonth(new Date(parsedYear, mo, 1))
              }}
            >
              <SelectTrigger aria-label="Select year" className="h-8 w-[88px] border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] text-xs text-[var(--color-text-secondary)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((year) => (
                  <SelectItem key={year} value={String(year)}>{year}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {loading && <Loader2 className="mr-0.5 h-3.5 w-3.5 animate-spin text-[var(--color-text-secondary)]" />}
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-[var(--color-text-secondary)]"
              onClick={() => setCurrentMonth(new Date(yr, mo - 1, 1))}
            >
              <ChevronLeft className="h-[18px] w-[18px]" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-elevated)]"
              onClick={() => setCurrentMonth(new Date())}
            >
              Today
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-[var(--color-text-secondary)]"
              onClick={() => setCurrentMonth(new Date(yr, mo + 1, 1))}
            >
              <ChevronRight className="h-[18px] w-[18px]" />
            </Button>
          </div>
        </div>

        {/* Legend */}
        <div className="mb-1 flex shrink-0 flex-wrap gap-2">
          {(Object.entries(TYPE_COLORS) as [CalObjectType, (typeof TYPE_COLORS)[CalObjectType]][]).map(
            ([type, colors]) => (
              <div key={type} className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-[2px] border" style={{ backgroundColor: colors.bg, borderColor: colors.border }} />
                <span className="text-[10px]" style={{ color: colors.text }}>
                  {TYPE_LABELS[type]}
                </span>
              </div>
            ),
          )}
        </div>

        {/* Day-of-week headers */}
        <div className="mb-0.5 grid shrink-0 grid-cols-7 gap-px">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <span key={d} className="py-0.5 text-center text-[11px] font-bold text-[var(--color-text-secondary)]">
              {d}
            </span>
          ))}
        </div>

        {/* Day cells - fixed width grid */}
        <div className="grid flex-1 grid-cols-7 content-start gap-0.5 overflow-auto">
          {cells.map((day, idx) => {
            if (!day) return <div key={`empty-${idx}`} className="min-h-[72px] rounded-md bg-transparent" />

            const date = fmt(yr, mo, day)
            const dayEvts = eventsForDate(date)
            const today = isToday(day)
            const selected = date === selectedDate

            return (
              <div
                key={date}
                onClick={() => handleDayClick(day)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setContextMenu({ mouseX: event.clientX + 2, mouseY: event.clientY - 6, date })
                }}
                className="flex min-h-[72px] min-w-0 cursor-pointer flex-col gap-0.5 rounded-md border px-1.5 py-1 transition-colors hover:bg-[var(--color-surface-sunken)]"
                style={{
                  borderColor: selected ? 'var(--color-border-strong)' : 'var(--color-border-subtle)',
                  backgroundColor: selected
                    ? 'rgba(56, 189, 248, 0.12)'
                    : today
                      ? 'rgba(56, 189, 248, 0.08)'
                      : 'var(--color-surface-app)',
                }}
              >
                <span
                  className="text-xs leading-[1.3]"
                  style={{
                    fontWeight: today ? 800 : 500,
                    color: today || selected ? 'var(--color-accent-selected)' : 'var(--color-text-primary)',
                  }}
                >
                  {day}
                </span>
                {dayEvts.slice(0, 3).map((evt) => {
                  const colors = TYPE_COLORS[evt.type]
                  return (
                    <div
                      key={evt.id}
                      onClick={(e) => { e.stopPropagation(); openEvent(evt) }}
                      className="cursor-pointer overflow-hidden rounded-[3px] border px-1 py-px hover:brightness-125"
                      style={{ backgroundColor: colors.bg, borderColor: colors.border }}
                    >
                      <span className="block truncate text-[10px]" style={{ color: colors.text }}>
                        {evt.type === 'daily-note' ? '📓 Daily'
                          : evt.type === 'habit' ? `🔁 ${evt.label}`
                          : evt.type === 'project' ? `📁 ${evt.label}`
                          : `📝 ${evt.label}`}
                      </span>
                    </div>
                  )
                })}
                {dayEvts.length > 3 && (
                  <span className="text-[10px] text-[var(--color-text-secondary)]">
                    +{dayEvts.length - 3} more
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {selectedObject && (
        <div className="flex min-h-0 w-[520px] min-w-[400px] flex-col rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)]">
          <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-2 py-1">
            <h3 className="text-lg font-bold">
              {selectedType === 'daily-note' ? 'Daily Note'
                : selectedType === 'habit' ? 'Habit'
                : selectedType === 'project' ? 'Project'
                : selectedType === 'ref-material' ? 'Reference Material'
                : 'Topic Note'}
            </h3>
            <Button size="icon" variant="ghost" onClick={handleCloseModal} className="h-8 w-8 text-[var(--color-text-secondary)]">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 overflow-hidden p-1.5">
            <EditorErrorBoundary>
              <ObjectEditor
                object={selectedObject}
                type={selectedType}
                onSave={handleSave}
                onDirty={setHasUnsavedChanges}
               onNavigateToObject={handleNavigateToObject}
             />
           </EditorErrorBoundary>
         </div>
       </div>
      )}

      {contextMenu && (
       <DropdownMenu open onOpenChange={(open) => { if (!open) setContextMenu(null) }}>
         <DropdownMenuTrigger asChild>
           <button
             type="button"
             aria-label="Open calendar context actions"
             className="fixed h-px w-px opacity-0"
             style={{ left: contextMenu.mouseX, top: contextMenu.mouseY }}
           />
         </DropdownMenuTrigger>
         <DropdownMenuContent align="start" className="w-44">
           <DropdownMenuItem
             onSelect={() => {
               startCreateForDate(contextMenu.date, 'daily-note')
               setContextMenu(null)
             }}
           >
             New Daily Note
           </DropdownMenuItem>
           <DropdownMenuItem
             onSelect={() => {
               startCreateForDate(contextMenu.date, 'topic-note')
               setContextMenu(null)
             }}
           >
             New Topic Note
           </DropdownMenuItem>
           <DropdownMenuItem
             onSelect={() => {
               startCreateForDate(contextMenu.date, 'habit')
               setContextMenu(null)
             }}
           >
             New Habit
           </DropdownMenuItem>
         </DropdownMenuContent>
       </DropdownMenu>
      )}

       {/* Confirmation Dialog for unsaved changes */}
      <Dialog open={showConfirmClose} onOpenChange={setShowConfirmClose}>
       <DialogContent>
         <DialogHeader>
           <DialogTitle>Unsaved Changes</DialogTitle>
           <DialogDescription>
             You have unsaved changes. Are you sure you want to close without saving?
           </DialogDescription>
         </DialogHeader>
         <DialogFooter>
           <Button variant="outline" onClick={() => setShowConfirmClose(false)}>Cancel</Button>
           <Button variant="destructive" onClick={handleConfirmClose}>
             Discard Changes
           </Button>
         </DialogFooter>
       </DialogContent>
      </Dialog>
    </div>
  )
}
