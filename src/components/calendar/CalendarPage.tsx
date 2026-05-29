import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { addDays, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from 'date-fns'
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal, SquarePen, X } from 'lucide-react'
import ObjectEditor from '../objects/ObjectEditor'
import EditorErrorBoundary from '../common/EditorErrorBoundary'
import { Button } from '../ui/button'
import FilterChip from '../ui/FilterChip'
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
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Input } from '../ui/input'
import { listHabitMeta, listMetaBundle, getObject } from '../../lib/cliService'
import type { ResolvedObjectRef } from '../../lib/cliService'
import { getTodayDate } from '../../lib/dateUtils'
import { getObjectColor, type ObjectColorToken } from '../../lib/objectColors'
import { cn } from '../../lib/utils'
import { itemMatchesTagFilters, type TagFilterState } from '../../lib/tagFilters'

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
  tags: string[]
}

interface CalendarPageProps {
  onOpenObjectTab?: (target: { id: string; type: CalObjectType; forceNewTab?: boolean }) => void | Promise<void>
  onStartCreateObject?: (target: { type: 'daily-note' | 'topic-note' | 'habit'; date: string }) => void | Promise<void>
  tagFilters?: TagFilterState
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

const CAL_OBJECT_TYPE_OPTIONS: Array<{ value: CalObjectType; label: string; checkedByDefault: boolean }> = [
  { value: 'daily-note', label: 'Daily Notes', checkedByDefault: true },
  { value: 'topic-note', label: 'Topic Notes', checkedByDefault: true },
  { value: 'habit', label: 'Habits', checkedByDefault: true },
  { value: 'project', label: 'Projects', checkedByDefault: true },
  { value: 'ref-material', label: 'Reference Materials', checkedByDefault: false },
]
const DEFAULT_VISIBLE_CAL_TYPES = CAL_OBJECT_TYPE_OPTIONS
  .filter((option) => option.checkedByDefault)
  .map((option) => option.value)
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

export default function CalendarPage({ onOpenObjectTab, onStartCreateObject, tagFilters = {} }: CalendarPageProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [events, setEvents] = useState<CalEvent[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedDate, setSelectedDate] = useState<string>(getTodayDate())
  const [selectedObject, setSelectedObject] = useState<Record<string, unknown> | undefined>()
  const [selectedType, setSelectedType] = useState<CalObjectType>('daily-note')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [showConfirmClose, setShowConfirmClose] = useState(false)
  const [visibleObjectTypes, setVisibleObjectTypes] = useState<CalObjectType[]>(DEFAULT_VISIBLE_CAL_TYPES)

  const today = useMemo(() => new Date(), [])
  const monthStart = useMemo(() => startOfMonth(currentMonth), [currentMonth])
  const gridStart = useMemo(() => startOfWeek(monthStart, { weekStartsOn: 0 }), [monthStart])
  const calendarDays = useMemo(
    () => Array.from({ length: 42 }, (_, index) => addDays(gridStart, index)),
    [gridStart],
  )
  const calendarWeeks = useMemo(
    () => Array.from({ length: 6 }, (_, weekIndex) => calendarDays.slice(weekIndex * 7, weekIndex * 7 + 7)),
    [calendarDays],
  )
  const createTargetDate = selectedDate || getTodayDate()
  const visibleObjectTypeSet = useMemo(() => new Set(visibleObjectTypes), [visibleObjectTypes])
  const isObjectTypeFilterCustomized = useMemo(
    () => CAL_OBJECT_TYPE_OPTIONS.some((option) => visibleObjectTypeSet.has(option.value) !== option.checkedByDefault),
    [visibleObjectTypeSet],
  )
  const toggleObjectTypeVisibility = useCallback((type: CalObjectType) => {
    setVisibleObjectTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return CAL_OBJECT_TYPE_OPTIONS.map((option) => option.value).filter((value) => next.has(value))
    })
  }, [])

  const loadEvents = useCallback(async () => {
    const bundle = await listMetaBundle()
    const evts: CalEvent[] = []
    for (const n of bundle.dailyNotes) {
      if (n.date) evts.push({ id: n.id, date: n.date, label: 'Daily Note', type: 'daily-note', tags: n.tags ?? [] })
    }
    for (const n of bundle.topicNotes) {
      const d = n.date
      if (d) evts.push({ id: n.id, date: d, label: n.displayTitle || d, type: 'topic-note', tags: n.tags ?? [] })
    }
    for (const h of bundle.habits) {
      if (h.date) evts.push({ id: h.id, date: h.date, label: h.displayTitle || 'Habit', type: 'habit', tags: h.tags ?? [] })
    }
    for (const p of bundle.files) {
      if (p.type === 'project' && p.startDate) {
        evts.push({ id: p.id, date: p.startDate, label: p.displayTitle, type: 'project', tags: p.tags ?? [] })
      }
      if (p.type === 'ref-material') {
        const datedRef = p.startDate
        if (datedRef) evts.push({ id: p.id, date: datedRef, label: p.displayTitle, type: 'ref-material', tags: p.tags ?? [] })
      }
    }
    setEvents(evts)
  }, [])

  useEffect(() => {
    loadEvents()
  }, [loadEvents])

  useEffect(() => {
    const handler = () => void loadEvents();
    window.addEventListener('puzzlepkm:objects-updated', handler);
    return () => window.removeEventListener('puzzlepkm:objects-updated', handler);
  }, [loadEvents])

  const filteredEvents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return events.filter((event) => {
      if (!visibleObjectTypeSet.has(event.type)) return false
      if (!itemMatchesTagFilters(event.tags, tagFilters)) return false
      if (!query) return true
      const typeLabel = TYPE_LABELS[event.type].toLowerCase()
      return event.label.toLowerCase().includes(query) || typeLabel.includes(query)
    })
  }, [events, searchQuery, tagFilters, visibleObjectTypeSet])

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

  const startCreateForDate = useCallback(async (date: string, type: CalObjectType) => {
    if (onStartCreateObject && (type === 'daily-note' || type === 'topic-note' || type === 'habit')) {
      await Promise.resolve(onStartCreateObject({ type, date }))
      return
    }

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
  }, [onStartCreateObject])

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
      <div className="ui-shell-panel flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-surface-elevated)]">
        <div className="ui-toolbar-panel flex min-h-[76px] flex-nowrap items-center gap-2 border-b border-[var(--color-border-subtle)] px-4 py-3">
          <div className="mr-2 py-1">
            <h2 className="calendar-filter-month-year font-semibold leading-none tracking-[-0.03em] text-[var(--color-text-primary)]">
              {monthLabel}{' '}
              <span className="text-[var(--color-accent-metadata)]">{yearLabel}</span>
            </h2>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-10 w-10 rounded-[10px] text-[var(--color-text-disabled)] hover:text-foreground" aria-label="Create new item">
                <SquarePen className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuItem onSelect={() => { void startCreateForDate(createTargetDate, 'daily-note') }}>
                New Daily Note
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { void startCreateForDate(createTargetDate, 'topic-note') }}>
                New Topic Note
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { void startCreateForDate(createTargetDate, 'habit') }}>
                New Habit
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="ui-scroller flex min-w-0 items-center gap-2 overflow-x-auto overflow-y-hidden px-1 py-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <FilterChip
                  icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
                  label="Object type"
                  showCaret
                  selected={isObjectTypeFilterCustomized}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {CAL_OBJECT_TYPE_OPTIONS.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.value}
                    checked={visibleObjectTypeSet.has(option.value)}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={() => toggleObjectTypeVisibility(option.value)}
                  >
                    {option.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="relative w-[248px] max-w-full min-w-0 flex-[1_1_120px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-disabled)]" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search"
              className="h-10 rounded-[10px] pl-10 pr-4 text-sm"
            />
          </div>

          <div className="ml-auto inline-flex shrink-0 items-center rounded-full border border-current bg-[var(--color-surface-control)]/88 p-1 text-[var(--color-text-disabled)] hover:bg-[var(--color-surface-hover)]">
            <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full border border-[var(--color-text-disabled)] bg-[var(--color-surface-control)]/88 text-[var(--color-text-disabled)] hover:border-[var(--color-border-strong)] hover:bg-transparent hover:text-foreground" onClick={handlePrevMonth}>
              <ChevronLeft className="h-4.5 w-4.5" />
            </Button>
            <Button size="sm" variant="ghost" className="h-8 rounded-full border border-[var(--color-text-disabled)] bg-[var(--color-surface-control)]/88 px-4 text-sm text-[var(--color-text-disabled)] hover:border-[var(--color-border-strong)] hover:bg-transparent hover:text-foreground" onClick={handleToday}>
              Today
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full border border-[var(--color-text-disabled)] bg-[var(--color-surface-control)]/88 text-[var(--color-text-disabled)] hover:border-[var(--color-border-strong)] hover:bg-transparent hover:text-foreground" onClick={handleNextMonth}>
              <ChevronRight className="h-4.5 w-4.5" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-7 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)]/85">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((dayLabel) => (
            <div key={dayLabel} className="px-3 py-2 text-right text-sm font-semibold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
              {dayLabel}
            </div>
          ))}
        </div>

        <div className="flex flex-1 flex-col overflow-auto bg-[var(--color-border-subtle)]/60">
          {calendarWeeks.map((week, weekIndex) => (
            <div key={`week-${weekIndex}`} className="grid grid-cols-7">
              {week.map((dayValue) => {
                const dateKey = formatDateKey(dayValue)
                const dayEvents = eventsByDate.get(dateKey) ?? []
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
                    <div className="mb-2 flex items-center justify-end gap-2">
                      <span
                        className={cn(
                          'inline-flex min-w-[28px] items-center justify-center rounded-full px-2 py-0.5 text-sm font-medium',
                          isTodayDate ? 'bg-[var(--color-selected-fill-soft)] text-[var(--color-text-primary)]' : '',
                        )}
                      >
                        {format(dayValue, 'd')}
                      </span>
                    </div>

                    <div className="flex flex-col gap-1">
                      {dayEvents.map((event) => {
                        const colors = TYPE_COLORS[event.type]
                        return (
                          <button
                            key={event.id}
                            type="button"
                            onClick={(clickEvent) => {
                              clickEvent.stopPropagation()
                              void openEvent(event)
                            }}
                            className="rounded-[7px] border px-2 py-1 text-left text-sm font-medium break-words whitespace-normal leading-snug hover:brightness-110"
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
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {selectedObject && !onOpenObjectTab && (
        <div className="flex min-h-0 w-[520px] min-w-[400px] flex-col overflow-hidden rounded-[24px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)]">
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
