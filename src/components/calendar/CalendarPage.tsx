import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { addDays, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from 'date-fns'
import { ChevronLeft, ChevronRight, Plus, Search, X } from 'lucide-react'
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
import { Input } from '../ui/input'
import { listDailyNoteMeta, listTopicNoteMeta, listHabitMeta, listFileMeta, getObject } from '../../lib/cliService'
import type { ResolvedObjectRef } from '../../lib/cliService'
import { getTodayDate } from '../../lib/dateUtils'
import { getObjectColor, type ObjectColorToken } from '../../lib/objectColors'
import { cn } from '../../lib/utils'

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

const TYPE_COLORS: Record<CalObjectType, ObjectColorToken> = {
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

const CALENDAR_VIEWS = ['Day', 'Week', 'Month', 'Quarter', 'Year'] as const
const EVENT_TYPE_ORDER: Record<CalObjectType, number> = {
  project: 0,
  'ref-material': 1,
  'topic-note': 2,
  habit: 3,
  'daily-note': 4,
}

function formatDateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

export default function CalendarPage({ onOpenObjectTab }: CalendarPageProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [events, setEvents] = useState<CalEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedDate, setSelectedDate] = useState<string>(getTodayDate())
  const [selectedObject, setSelectedObject] = useState<Record<string, unknown> | undefined>()
  const [selectedType, setSelectedType] = useState<CalObjectType>('daily-note')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [showConfirmClose, setShowConfirmClose] = useState(false)

  const today = useMemo(() => new Date(), [])
  const monthStart = useMemo(() => startOfMonth(currentMonth), [currentMonth])
  const gridStart = useMemo(() => startOfWeek(monthStart, { weekStartsOn: 0 }), [monthStart])
  const calendarDays = useMemo(
    () => Array.from({ length: 42 }, (_, index) => addDays(gridStart, index)),
    [gridStart],
  )
  const createTargetDate = selectedDate || getTodayDate()

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
          if (n.date) evts.push({ id: n.id, date: n.date, label: 'Daily Note', type: 'daily-note' })
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

  const filteredEvents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return events
    return events.filter((event) => {
      const typeLabel = TYPE_LABELS[event.type].toLowerCase()
      return event.label.toLowerCase().includes(query) || typeLabel.includes(query)
    })
  }, [events, searchQuery])

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalEvent[]>()
    for (const event of filteredEvents) {
      const existing = map.get(event.date) ?? []
      existing.push(event)
      map.set(event.date, existing)
    }
    for (const [dateKey, dateEvents] of map.entries()) {
      map.set(
        dateKey,
        dateEvents.slice().sort((left, right) => {
          const byType = EVENT_TYPE_ORDER[left.type] - EVENT_TYPE_ORDER[right.type]
          if (byType !== 0) return byType
          return left.label.localeCompare(right.label, undefined, { sensitivity: 'base' })
        }),
      )
    }
    return map
  }, [filteredEvents])

  const visibleEventCount = filteredEvents.filter((event) => event.type !== 'daily-note').length

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
    async (dateValue: Date) => {
      const date = formatDateKey(dateValue)
      setSelectedDate(date)
      setCurrentMonth(dateValue)
      const dayEvts = (eventsByDate.get(date) ?? []).filter((event) => event.type !== 'daily-note')
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
    [eventsByDate, onOpenObjectTab, openEvent],
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

  const handleToday = useCallback(() => {
    const next = new Date()
    setCurrentMonth(next)
    setSelectedDate(formatDateKey(next))
  }, [])

  const handlePrevMonth = useCallback(() => {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
  }, [])

  const handleNextMonth = useCallback(() => {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
  }, [])

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

  const monthLabel = format(currentMonth, 'MMMM')
  const yearLabel = format(currentMonth, 'yyyy')

  return (
    <div className="flex min-h-0 flex-1 gap-3">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[24px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)]">
        <div className="border-b border-[var(--color-border-subtle)] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-10 w-10 rounded-full">
                    <Plus className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  <DropdownMenuItem onSelect={() => startCreateForDate(createTargetDate, 'daily-note')}>
                    New Daily Note
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => startCreateForDate(createTargetDate, 'topic-note')}>
                    New Topic Note
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => startCreateForDate(createTargetDate, 'habit')}>
                    New Habit
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="inline-flex items-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] p-1">
                <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full" onClick={handlePrevMonth}>
                  <ChevronLeft className="h-4.5 w-4.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-8 rounded-full px-4 text-sm text-[var(--color-text-primary)]" onClick={handleToday}>
                  Today
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full" onClick={handleNextMonth}>
                  <ChevronRight className="h-4.5 w-4.5" />
                </Button>
              </div>
            </div>

            <div className="hidden rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] p-1 lg:flex">
              {CALENDAR_VIEWS.map((view) => {
                const active = view === 'Month'
                return (
                  <button
                    key={view}
                    type="button"
                    aria-pressed={active}
                    className={cn(
                      'rounded-full px-4 py-1.5 text-sm transition-colors',
                      active
                        ? 'bg-[var(--color-surface-control)] text-[var(--color-text-primary)]'
                        : 'text-[var(--color-text-secondary)]',
                    )}
                  >
                    {view}
                  </button>
                )
              })}
            </div>

            <div className="relative w-full max-w-[280px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-disabled)]" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search"
                className="h-10 rounded-full pl-9"
              />
            </div>
          </div>

          <div className="mt-5 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-[44px] font-semibold leading-none tracking-[-0.03em] text-[var(--color-text-primary)]">
                {monthLabel}{' '}
                <span className="text-[var(--color-accent-metadata)]">{yearLabel}</span>
              </h2>
            </div>
            <div className="text-xs text-[var(--color-text-secondary)]">
              {loading ? 'Loading events…' : searchQuery.trim() ? `${visibleEventCount} matching events` : `${visibleEventCount} events this month`}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-7 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)]/85">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((dayLabel) => (
            <div key={dayLabel} className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
              {dayLabel}
            </div>
          ))}
        </div>

        <div
          className="grid flex-1 grid-cols-7 overflow-auto bg-[var(--color-border-subtle)]/60"
          style={{ gridTemplateRows: 'repeat(6, minmax(136px, 1fr))' }}
        >
          {calendarDays.map((dayValue) => {
            const dateKey = formatDateKey(dayValue)
            const dayEvents = eventsByDate.get(dateKey) ?? []
            const dailyNote = dayEvents.find((event) => event.type === 'daily-note')
            const nonNoteEvents = dayEvents.filter((event) => event.type !== 'daily-note')
            const visibleDayEvents = nonNoteEvents.slice(0, 4)
            const hiddenCount = Math.max(nonNoteEvents.length - visibleDayEvents.length, 0)
            const selected = dateKey === selectedDate
            const isCurrentMonthDay = isSameMonth(dayValue, currentMonth)
            const isTodayDate = isSameDay(dayValue, today)

            return (
              <div
                key={dateKey}
                onClick={() => { void handleDayClick(dayValue) }}
                className={cn(
                  'flex min-h-[136px] min-w-0 cursor-pointer flex-col bg-[var(--color-surface-app)] px-2.5 py-2 transition-colors',
                  isCurrentMonthDay ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-disabled)]',
                )}
                style={{
                  boxShadow: selected ? 'inset 0 0 0 1px rgba(242, 203, 99, 0.28)' : 'none',
                  backgroundColor: selected
                    ? 'color-mix(in srgb, var(--color-selected-fill-soft) 55%, var(--color-surface-app))'
                    : isCurrentMonthDay
                      ? 'var(--color-surface-app)'
                      : 'color-mix(in srgb, var(--color-surface-app) 82%, var(--color-surface-elevated))',
                }}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  {dailyNote ? (
                    <span className="inline-flex items-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-control)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
                      Note
                    </span>
                  ) : <span />}
                  <span
                    className={cn(
                      'inline-flex min-w-[28px] items-center justify-center rounded-full px-2 py-0.5 text-sm font-medium',
                      isTodayDate ? 'bg-[var(--color-selected-fill-soft)] text-[var(--color-text-primary)]' : '',
                    )}
                  >
                    {format(dayValue, 'd')}
                  </span>
                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
                  {visibleDayEvents.map((event, index) => {
                    const colors = TYPE_COLORS[event.type]
                    const compact = index >= 2
                    return compact ? (
                      <button
                        key={event.id}
                        type="button"
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation()
                          void openEvent(event)
                        }}
                        className="flex items-center gap-1.5 rounded-[6px] px-1 py-0.5 text-left text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
                      >
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colors.accent }} />
                        <span className="truncate">{event.label}</span>
                      </button>
                    ) : (
                      <button
                        key={event.id}
                        type="button"
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation()
                          void openEvent(event)
                        }}
                        className="truncate rounded-[7px] border px-2 py-1 text-left text-[11px] font-medium hover:brightness-110"
                        style={{
                          backgroundColor: colors.bg,
                          borderColor: colors.border,
                          color: colors.text,
                        }}
                      >
                        {event.label}
                      </button>
                    )
                  })}

                  {hiddenCount > 0 ? (
                    <span className="px-1 text-[11px] text-[var(--color-text-disabled)]">
                      +{hiddenCount} more
                    </span>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {selectedObject && !onOpenObjectTab && (
        <div className="flex min-h-0 w-[520px] min-w-[400px] flex-col rounded-[24px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)]">
          <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-3 py-2">
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
