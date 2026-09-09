import { Button, FilterChip, Calendar, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Input, CalendarPage as SharedCalendarPage } from 'aslan-ui';
import React, { useState, useEffect, useCallback, useDeferredValue, useMemo, useRef } from 'react'
import { format, isValid, parseISO } from 'date-fns'
import * as Popover from '@radix-ui/react-popover'
import { CalendarIcon, Search, SlidersHorizontal, SquarePen, X } from 'lucide-react'
import ObjectEditor from '../objects/ObjectEditor'
import EditorErrorBoundary from '../common/EditorErrorBoundary'
import HabitLogDialog from '../habits/HabitLogDialog'
import MentionPopup, { type MentionOption } from '../common/MentionPopup'

import { listMetaBundle, getObject, rankSearchCandidates } from '../../lib/cliService'
import type { ResolvedObjectRef } from '../../lib/cliService'
import { getTodayDate } from '../../lib/dateUtils'
import { getObjectColor, type ObjectColorToken } from '../../lib/objectColors'
import { itemMatchesTagFilters, type TagFilterState } from '../../lib/tagFilters'
import { useUnsavedChangesStore } from '../../lib/unsavedChangesStore'


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

interface CalendarSearchCandidate {
  id: string
  type: CalObjectType
  title: string
  date?: string
  metadata?: string
  snippet?: string
  contentSearch?: string
  tags: string[]
}

interface CalendarSearchOption extends MentionOption {
  objectId: string
  objectType: CalObjectType
  hasDate: boolean
}

interface CalendarPageProps {
  onOpenObjectTab?: (target: { id: string; type: CalObjectType; forceNewTab?: boolean }) => void | Promise<void>
  onStartCreateObject?: (target: { type: 'daily-note' | 'topic-note'; date: string }) => void | Promise<void>
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
  // Habit markers open the day they happened on, so the calendar needs the
  // daily note behind each date.
  const [dailyNoteIdByDate, setDailyNoteIdByDate] = useState<Map<string, string>>(new Map())
  // Adding a habit from a day means it happened on that day, so the dialog
  // logs an occurrence of an existing habit; creating one is the second step.
  const [loggingHabitOn, setLoggingHabitOn] = useState<string | null>(null)
  const [searchCandidates, setSearchCandidates] = useState<CalendarSearchCandidate[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const [searchFocused, setSearchFocused] = useState(false)
  const [searchSelectedIndex, setSearchSelectedIndex] = useState(0)
  const [searchPopupPosition, setSearchPopupPosition] = useState<{ top: number; left: number } | null>(null)
  const [selectedDate, setSelectedDate] = useState<string>(getTodayDate())
  const [selectedObject, setSelectedObject] = useState<Record<string, unknown> | undefined>()
  const [selectedType, setSelectedType] = useState<Exclude<CalObjectType, 'habit'>>('daily-note')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [showConfirmClose, setShowConfirmClose] = useState(false)
  const [visibleObjectTypes, setVisibleObjectTypes] = useState<CalObjectType[]>(DEFAULT_VISIBLE_CAL_TYPES)
  const [jumpDateOpen, setJumpDateOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    useUnsavedChangesStore.getState().setDirty('calendar', hasUnsavedChanges)
  }, [hasUnsavedChanges])



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
    const candidates: CalendarSearchCandidate[] = []
    for (const n of bundle.dailyNotes) {
      if (n.date) evts.push({ id: n.id, date: n.date, label: 'Daily Note', type: 'daily-note', tags: n.tags ?? [] })
      candidates.push({
        id: n.id,
        type: 'daily-note',
        title: n.displayTitle || 'Daily Note',
        date: n.date || undefined,
        metadata: TYPE_LABELS['daily-note'],
        snippet: n.preview,
        contentSearch: n.contentSearch,
        tags: n.tags ?? [],
      })
    }
    for (const n of bundle.topicNotes) {
      const d = n.date
      if (d) evts.push({ id: n.id, date: d, label: n.displayTitle || d, type: 'topic-note', tags: n.tags ?? [] })
      candidates.push({
        id: n.id,
        type: 'topic-note',
        title: n.displayTitle || 'Topic Note',
        date: d || undefined,
        metadata: TYPE_LABELS['topic-note'],
        snippet: n.preview,
        contentSearch: n.contentSearch,
        tags: n.tags ?? [],
      })
    }
    for (const h of bundle.habits) {
      // One marker per logged occurrence — the gaps between them are the point.
      for (const entry of h.entries) {
        evts.push({ id: h.id, date: entry.date, label: h.name || 'Habit', type: 'habit', tags: h.tags ?? [] })
      }
      candidates.push({
        id: h.id,
        type: 'habit',
        title: h.name || 'Habit',
        date: h.stats.lastDate ?? undefined,
        metadata: TYPE_LABELS.habit,
        snippet: h.stats.lastDate ? `Last logged ${h.stats.lastDate}` : 'Never logged',
        contentSearch: h.contentSearch,
        tags: h.tags ?? [],
      })
    }
    for (const p of bundle.files) {
      if (p.type === 'project' && p.startDate) {
        evts.push({ id: p.id, date: p.startDate, label: p.displayTitle, type: 'project', tags: p.tags ?? [] })
      }
      if (p.type === 'ref-material') {
        const datedRef = p.startDate
        if (datedRef) evts.push({ id: p.id, date: datedRef, label: p.displayTitle, type: 'ref-material', tags: p.tags ?? [] })
      }
      candidates.push({
        id: p.id,
        type: p.type,
        title: p.displayTitle,
        date: p.startDate || undefined,
        metadata: p.type === 'project'
          ? TYPE_LABELS.project
          : (p.author ? `${TYPE_LABELS['ref-material']} by ${p.author}` : TYPE_LABELS['ref-material']),
        contentSearch: p.author,
        tags: p.tags ?? [],
      })
    }
    setDailyNoteIdByDate(new Map(
      bundle.dailyNotes.filter((note) => note.date && note.id).map((note) => [note.date, note.id]),
    ))
    setEvents(evts)
    setSearchCandidates(candidates)
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
    return events.filter((event) => {
      if (!visibleObjectTypeSet.has(event.type)) return false
      if (!itemMatchesTagFilters(event.tags, tagFilters)) return false
      return true
    })
  }, [events, tagFilters, visibleObjectTypeSet])

  const searchOptions = useMemo<CalendarSearchOption[]>(() => {
    const query = deferredSearchQuery.trim().toLowerCase()
    if (!query) return []
    const visible = searchCandidates.filter((candidate) => {
      if (!visibleObjectTypeSet.has(candidate.type)) return false
      if (!itemMatchesTagFilters(candidate.tags, tagFilters)) return false
      return true
    })
    const ranked = rankSearchCandidates(
      query,
      visible.map((candidate, index) => ({
        id: `${candidate.type}:${candidate.id}`,
        type: candidate.type,
        title: candidate.title,
        date: candidate.date,
        metadata: candidate.metadata,
        snippet: candidate.snippet,
        contentSearch: candidate.contentSearch,
        tags: candidate.tags,
        sourceOrder: index,
        candidate,
      })),
    )
    const datedFirst = ranked.filter((entry) => entry.item.candidate.date)
    const undated = ranked.filter((entry) => !entry.item.candidate.date)
    return [...datedFirst, ...undated].slice(0, 8).map((entry) => ({
      id: entry.item.id,
      objectId: entry.item.candidate.id,
      objectType: entry.item.candidate.type,
      type: entry.item.candidate.type,
      title: entry.item.candidate.title,
      date: entry.item.candidate.date,
      blockPreview: entry.item.candidate.metadata,
      hasDate: Boolean(entry.item.candidate.date),
    }))
  }, [deferredSearchQuery, searchCandidates, tagFilters, visibleObjectTypeSet])

  const showSearchPopup = searchFocused && searchQuery.trim().length > 0

  useEffect(() => {
    if (!showSearchPopup) {
      setSearchPopupPosition(null)
      return
    }
    const updatePosition = () => {
      const input = searchInputRef.current
      if (!input) return
      const rect = input.getBoundingClientRect()
      setSearchPopupPosition({ top: rect.bottom + 6, left: rect.left })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [showSearchPopup])

  useEffect(() => {
    setSearchSelectedIndex(0)
  }, [deferredSearchQuery])

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
    // A habit marker is an occurrence, not an object to edit. Open the day it
    // happened on — that is where the habit panel lives.
    const target = evt.type === 'habit'
      ? { id: dailyNoteIdByDate.get(evt.date), type: 'daily-note' as const }
      : { id: evt.id, type: evt.type }

    if (evt.type === 'habit' && !target.id) {
      setSelectedDate(evt.date)
      return
    }

    if (onOpenObjectTab) {
      setSelectedDate(evt.date)
      await Promise.resolve(onOpenObjectTab({ id: target.id as string, type: target.type, forceNewTab: true }))
      return
    }

    setSelectedDate(evt.date)
    setSelectedType(target.type)
    try {
      const full = await getObject(target.type, target.id as string)
      setSelectedObject({ ...full, type: target.type })
    } catch {
      setSelectedObject({ id: target.id, date: evt.date, type: target.type, contentMarkdown: '', tags: [] })
    }
  }, [onOpenObjectTab, dailyNoteIdByDate])

  const navigateToDate = useCallback((date: string) => {
    setSelectedDate(date)
    const parsed = parseISO(date)
    if (isValid(parsed)) setCurrentMonth(parsed)
  }, [])

  const handleSelectSearchOption = useCallback(async (option: CalendarSearchOption) => {
    setSearchQuery('')
    setSearchSelectedIndex(0)
    if (option.date) {
      navigateToDate(option.date)
      return
    }
    if (onOpenObjectTab) {
      await Promise.resolve(onOpenObjectTab({ id: option.objectId, type: option.objectType, forceNewTab: true }))
      return
    }
    // A habit has no single date and no editor of its own; the Library is where
    // its history is shown.
    if (option.objectType === 'habit') return
    const editorType = option.objectType
    try {
      const full = await getObject(editorType, option.objectId)
      setSelectedType(editorType)
      setSelectedObject({ ...full, type: editorType })
    } catch {
      setSelectedType(editorType)
      setSelectedObject({ id: option.objectId, type: editorType, tags: [] })
    }
  }, [navigateToDate, onOpenObjectTab])

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
    if (onStartCreateObject && (type === 'daily-note' || type === 'topic-note')) {
      await Promise.resolve(onStartCreateObject({ type, date }))
      return
    }

    setSelectedDate(date)
    if (type === 'habit') return
    setSelectedType(type)
    if (type === 'daily-note') {
      setSelectedObject({ date, type: 'daily-note', contentMarkdown: '', tags: [], linkedObjectIds: [] })
      return
    }
    if (type === 'topic-note') {
      setSelectedObject({ title: '', date, type: 'topic-note', contentMarkdown: '', tags: [], linkedObjectIds: [] })
      return
    }
  }, [onStartCreateObject])

  const handleConfirmClose = () => {
    setShowConfirmClose(false)
    setHasUnsavedChanges(false)
    setSelectedObject(undefined)
  }

  const selectedJumpDate = useMemo(() => {
    if (!selectedDate) return undefined
    const parsed = parseISO(selectedDate)
    return isValid(parsed) ? parsed : undefined
  }, [selectedDate])

  const handleJumpDateSelect = useCallback((date?: Date) => {
    if (!date) return
    setSelectedDate(formatDateKey(date))
    setCurrentMonth(date)
    setJumpDateOpen(false)
  }, [])

  const handleNavigateToObject = useCallback(async (target: ResolvedObjectRef) => {
    // Habits are practices rather than dated entries; the calendar shows their
    // occurrences but does not open them.
    if (!isCalObjectType(target.type) || target.type === 'habit') return
    const editorType = target.type
    try {
      const full = await getObject(editorType, target.id)
      if (full && typeof full === 'object') {
        setSelectedType(editorType)
        setSelectedObject({ ...full, type: editorType })
        setHasUnsavedChanges(false)
      }
    } catch {
      // Keep the current object open.
    }
  }, [])



  const calendarPageItems = useMemo(() => {
    return filteredEvents.map((evt) => {
      const colors = TYPE_COLORS[evt.type]
      return {
        id: evt.id,
        date: evt.date,
        label: evt.label,
        type: evt.type,
        color: colors,
        originalObject: evt,
      }
    })
  }, [filteredEvents])

  return (
    <div className="flex min-h-0 flex-1 gap-3">
      <div className="ui-shell-panel flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-surface-elevated)]">
        <SharedCalendarPage
          month={currentMonth}
          onMonthChange={setCurrentMonth}
          items={calendarPageItems}
          onItemClick={(item) => {
            if (item.originalObject) {
              void openEvent(item.originalObject as CalEvent)
            }
          }}
          onDayClick={(dayVal: Date) => handleDayClick(dayVal)}
          onStartCreate={(date, type) => startCreateForDate(date, type as CalObjectType)}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          toolbarFilters={
            <>
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
                  <DropdownMenuItem onSelect={() => setLoggingHabitOn(createTargetDate)}>
                    Log Habit…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

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

              <div className="relative w-[248px] max-w-full min-w-0 flex-[1_1_120px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-disabled)]" />
                <Input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => {
                    window.setTimeout(() => setSearchFocused(false), 120)
                  }}
                  onKeyDown={(event) => {
                    if (!showSearchPopup) return
                    if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      setSearchSelectedIndex((idx) => Math.min(idx + 1, Math.max(searchOptions.length - 1, 0)))
                    } else if (event.key === 'ArrowUp') {
                      event.preventDefault()
                      setSearchSelectedIndex((idx) => Math.max(idx - 1, 0))
                    } else if (event.key === 'Enter') {
                      const option = searchOptions[searchSelectedIndex]
                      if (!option) return
                      event.preventDefault()
                      void handleSelectSearchOption(option)
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      setSearchFocused(false)
                    }
                  }}
                  placeholder="Search"
                  className="h-10 rounded-[10px] pl-10 pr-4 text-sm"
                />
              </div>
              {showSearchPopup && (
                <MentionPopup
                  query={searchQuery}
                  options={searchOptions}
                  selectedIndex={Math.min(searchSelectedIndex, Math.max(searchOptions.length - 1, 0))}
                  onSelect={(option) => {
                    const selected = searchOptions.find((entry) => entry.id === option.id && entry.type === option.type)
                    if (!selected) return
                    void handleSelectSearchOption(selected)
                  }}
                  onClose={() => setSearchFocused(false)}
                  position={searchPopupPosition}
                />
              )}

              <Popover.Root open={jumpDateOpen} onOpenChange={setJumpDateOpen}>
                <Popover.Trigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 rounded-[10px] text-[var(--color-text-disabled)] hover:text-foreground"
                    aria-label="Jump to date"
                    title={selectedDate ? `Jump date: ${selectedDate}` : 'Jump to date'}
                  >
                    <CalendarIcon className="h-4 w-4" />
                  </Button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content
                    sideOffset={8}
                    align="start"
                    className="z-50 rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] p-0 text-[var(--color-text-primary)] shadow-xl outline-none"
                  >
                    <Calendar
                      mode="single"
                      selected={selectedJumpDate}
                      defaultMonth={selectedJumpDate ?? currentMonth}
                      onSelect={handleJumpDateSelect}
                      captionLayout="dropdown"
                      startMonth={new Date(2000, 0)}
                      endMonth={new Date(2040, 11)}
                    />
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            </>
          }
        />
      </div>


      {selectedObject && !onOpenObjectTab && (
        <div className="flex min-h-0 w-[520px] min-w-[400px] flex-col overflow-hidden rounded-[24px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)]">
          <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-3 py-2">
            <h3 className="text-lg font-bold">
              {selectedType === 'daily-note' ? 'Daily Note'
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

      {loggingHabitOn && (
        <HabitLogDialog
          date={loggingHabitOn}
          onClose={() => setLoggingHabitOn(null)}
          onChanged={() => { void loadEvents() }}
        />
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
