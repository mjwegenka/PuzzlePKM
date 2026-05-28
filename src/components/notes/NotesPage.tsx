import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  ArrowUpDown,
  CalendarDays,
  Inbox,
  Loader2,
  NotebookPen,
  Repeat2,
  Search,
  SlidersHorizontal,
  SquarePen,
  X,
} from 'lucide-react'
import ObjectEditor from '../objects/ObjectEditor'
import ObjectMetaDetailPanel from '../objects/ObjectMetaDetailPanel'
import EditorErrorBoundary from '../common/EditorErrorBoundary'
import FilterChip from '../ui/FilterChip'
import { NoteCard } from '../ui/NoteCard'
import type { NoteCardData } from '../ui/NoteCard'
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
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Input } from '../ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import {
  getObject,
  listDailyNoteMeta,
  listFileMeta,
  listHabitMeta,
  listScriptureMeta,
  listTopicNoteMeta,
  type ResolvedObjectRef,
} from '@/lib/cliService'
import { formatDatePretty, formatWeekdayFull, getTodayDate } from '@/lib/dateUtils'
import { hasActiveTagFilters, itemMatchesTagFilters, type TagFilterState } from '@/lib/tagFilters'
import { cn } from '@/lib/utils'

function normalizePathForLookup(path?: string): string {
  return String(path ?? '')
    .trim()
    .replace(/[?#].*$/, '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .toLowerCase()
}

type NoteType = 'topic-note' | 'daily-note' | 'habit'
type EditorObjectType = NoteType | 'project' | 'ref-material' | 'scripture' | 'tag'

interface NotesPageProps {
  onSaved?: () => void
  pendingSelection?: { id: string; type: EditorObjectType; nonce: number } | null
  onPendingSelectionHandled?: (nonce: number) => void
  pendingCreate?: { type: NoteType; date?: string; nonce: number } | null
  onPendingCreateHandled?: (nonce: number) => void
  tagFilters?: TagFilterState
}

// ── Typed list items ──────────────────────────────────────────────────────────

interface TopicItem {
  id: string
  title: string
  preview: string
  date?: string
  updatedAt: string
  tags: string[]
  type: 'topic-note'
}

interface DailyItem {
  id: string
  date: string
  preview: string
  tags: string[]
  type: 'daily-note'
}

interface HabitItem {
  id: string
  date: string
  text: string
  tags: string[]
  type: 'habit'
}

interface FileItem {
  id: string
  name: string
  author?: string
  syncPath: string
  startDate?: string
  tags: string[]
  type: 'project' | 'ref-material'
}

interface ScriptureItem {
  id: string
  reference: string
  passageUrl: string
  noteCount: number
  type: 'scripture'
}

interface ActiveLibraryObject {
  objectId: string
  type: EditorObjectType
  object: Record<string, unknown>
  isDirty: boolean
}

// ── Unified card board ────────────────────────────────────────────────────────

/** Internal board card shape — maps 1:1 to NoteCardData for rendering. */
interface BoardCard extends NoteCardData {
  type: NoteCardData['type']
  sortTimestamp: number
}

type BoardSort = 'recent' | 'oldest' | 'title-asc' | 'title-desc'
type LibraryObjectFilterType = EditorObjectType | 'tag' | 'scripture'

const LIBRARY_OBJECT_TYPE_OPTIONS: Array<{ value: LibraryObjectFilterType; label: string; checkedByDefault: boolean }> = [
  { value: 'topic-note', label: 'Topic Notes', checkedByDefault: true },
  { value: 'daily-note', label: 'Daily Notes', checkedByDefault: true },
  { value: 'habit', label: 'Habits', checkedByDefault: false },
  { value: 'project', label: 'Projects', checkedByDefault: true },
  { value: 'ref-material', label: 'Reference Materials', checkedByDefault: true },
  { value: 'tag', label: 'Tags', checkedByDefault: false },
  { value: 'scripture', label: 'Scripture', checkedByDefault: false },
]

const DEFAULT_VISIBLE_LIBRARY_TYPES = LIBRARY_OBJECT_TYPE_OPTIONS
  .filter((option) => option.checkedByDefault)
  .map((option) => option.value)

const BOARD_SORT_LABELS: Record<BoardSort, string> = {
  recent: 'Newest',
  oldest: 'Oldest',
  'title-asc': 'Title A–Z',
  'title-desc': 'Title Z–A',
}

const LIBRARY_LIST_WIDTH_STORAGE_KEY = 'puzzlepkm:library-list-width:v1'
const LIBRARY_LIST_MIN_WIDTH = 320
const LIBRARY_LIST_DEFAULT_WIDTH = 372
const LIBRARY_DETAIL_MIN_WIDTH = 420
const LIBRARY_COLUMN_GAP_PX = 12

function clampLibraryListWidth(width: number, containerWidth?: number): number {
  const maxFromContainer = typeof containerWidth === 'number'
    ? Math.max(LIBRARY_LIST_MIN_WIDTH, containerWidth - LIBRARY_DETAIL_MIN_WIDTH - LIBRARY_COLUMN_GAP_PX)
    : Number.POSITIVE_INFINITY

  return Math.min(maxFromContainer, Math.max(LIBRARY_LIST_MIN_WIDTH, width))
}

function sanitizeCardText(value: string): string {
  return String(value)
    // Remove block-id comments that can leak into previews.
    .replace(/<!--\s*blk-[a-f0-9]{12}\s*-->/gi, ' ')
    // Remove generic HTML comments.
    .replace(/<!--[^]*?-->/g, ' ')
    // Remove HTML tags like <br>, <div>, etc.
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function sanitizeCardPreview(value: string): string {
  return String(value)
    // Remove block-id comments that can leak into previews.
    .replace(/<!--\s*blk-[a-f0-9]{12}\s*-->/gi, ' ')
    // Remove generic HTML comments.
    .replace(/<!--[^]*?-->/g, ' ')
    // Preserve source line structure where possible.
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normalizeSearchQuery(value: string): string {
  return String(value).trim().toLowerCase()
}

function cardMatchesSearch(card: Pick<BoardCard, 'title' | 'metadata' | 'snippet'>, query: string): boolean {
  if (!query) return true
  return [card.title, card.metadata, card.snippet].some((value) =>
    String(value ?? '').toLowerCase().includes(query),
  )
}

function deriveTopicCardTitle(title: string, preview: string, date?: string): string {
  const trimmedTitle = sanitizeCardText(title)
  if (trimmedTitle) return trimmedTitle

  // Strip block-id comments and markdown artifacts from previews before using as a fallback title.
  const previewCandidate = sanitizeCardText(preview)
    .replaceAll('[', ' ')
    .replaceAll(']', ' ')
    .replace(/[*_`#>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (previewCandidate) {
    return previewCandidate.slice(0, 60)
  }

  if (date) return formatDatePretty(date)
  return 'Topic Note'
}

function deriveHabitCardTitle(tags: string[], date: string, text: string): string {
  const primaryTag = tags
    .map((tag) => String(tag ?? '').trim())
    .find(Boolean)
  const friendlyDate = date ? formatDatePretty(date) : ''

  if (primaryTag && friendlyDate) return `${primaryTag} - ${friendlyDate}`
  if (primaryTag) return primaryTag
  if (friendlyDate) return friendlyDate
  return sanitizeCardText(text) || '(no text)'
}

function toSortTimestamp(...values: Array<string | undefined>): number {
  for (const value of values) {
    const timestamp = Date.parse(String(value ?? ''))
    if (!Number.isNaN(timestamp)) return timestamp
  }
  return 0
}

// ── Create panel (type selector + blank editor) ───────────────────────────────

interface CreatePanelProps {
  createType: NoteType
  initialDate?: string
  createKey: number
  onTypeChange: (t: NoteType) => void
  onSave: (saved: Record<string, unknown>) => void
  onClose: () => void
  onDirty?: (isDirty: boolean) => void
  onNavigateToObject?: (target: ResolvedObjectRef) => void | Promise<void>
  onCreateDateChange?: (date: string) => void | Promise<void>
  showHeader?: boolean
}

function CreatePanel({
  createType,
  initialDate,
  createKey,
  onTypeChange,
  onSave,
  onClose,
  onDirty,
  onNavigateToObject,
  onCreateDateChange,
  showHeader = true,
}: CreatePanelProps) {
  const blankObject = useMemo(() => (
    createType === 'daily-note'
      ? { date: initialDate || getTodayDate(), contentMarkdown: '', tags: [], linkedObjectIds: [] }
      : createType === 'topic-note'
        ? { title: '', date: initialDate ?? '', contentMarkdown: '', tags: [], linkedObjectIds: [] }
        : { date: initialDate || getTodayDate(), text: '', tags: [] }
  ), [createType, initialDate])

  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)]">
      {/* Panel header */}
      {showHeader ? (
        <div className="flex shrink-0 items-center justify-between px-2.5 pb-1.5 pt-2">
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--color-text-disabled)]">
            New Note
          </p>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 rounded-full text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)]">
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : null}

      {/* Type selector */}
      <div className={`shrink-0 px-2 pb-1.5 ${showHeader ? 'pt-0' : 'pt-2'}`}>
        <Tabs value={createType} onValueChange={(value) => onTypeChange(value as NoteType)}>
          <TabsList className="grid h-10 w-full grid-cols-3 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] p-1 text-[var(--color-text-disabled)]">
            <TabsTrigger value="topic-note" className="gap-1.5 rounded-full px-2 text-sm font-medium data-[state=active]:bg-[var(--color-selected-fill-soft)] data-[state=active]:text-[var(--color-text-primary)]">
              <NotebookPen className="h-3.5 w-3.5" />
              Topic
            </TabsTrigger>
            <TabsTrigger value="daily-note" className="gap-1.5 rounded-full px-2 text-sm font-medium data-[state=active]:bg-[var(--color-selected-fill-soft)] data-[state=active]:text-[var(--color-text-primary)]">
              <CalendarDays className="h-3.5 w-3.5" />
              Daily
            </TabsTrigger>
            <TabsTrigger value="habit" className="gap-1.5 rounded-full px-2 text-sm font-medium data-[state=active]:bg-[var(--color-selected-fill-soft)] data-[state=active]:text-[var(--color-text-primary)]">
              <Repeat2 className="h-3.5 w-3.5" />
              Habit
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="h-px shrink-0 bg-[var(--color-border-subtle)]" />

      {/* Blank editor fills remaining space */}
      <div className="flex min-h-0 flex-1 p-0">
        <ObjectEditor
          key={createKey}
          object={blankObject}
          type={createType}
          onSave={onSave}
          onCancel={onClose}
          onDirty={onDirty}
          onNavigateToObject={onNavigateToObject}
          onDateChange={createType === 'daily-note' ? onCreateDateChange : undefined}
        />
      </div>
    </section>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NotesPage({
  onSaved,
  pendingSelection,
  onPendingSelectionHandled,
  pendingCreate,
  onPendingCreateHandled,
  tagFilters = {},
}: NotesPageProps) {
  const listRowRef = useRef<HTMLDivElement | null>(null)
  const [isSmallScreen, setIsSmallScreen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 900 : false))
  const [topicNotes, setTopicNotes] = useState<TopicItem[]>([])
  const [dailyNotes, setDailyNotes] = useState<DailyItem[]>([])
  const [habits, setHabits] = useState<HabitItem[]>([])
  const [files, setFiles] = useState<FileItem[]>([])
  const [scriptures, setScriptures] = useState<ScriptureItem[]>([])
  const [loading, setLoading] = useState(false)

  const [activeObject, setActiveObject] = useState<ActiveLibraryObject | null>(null)
  const [deferredSelection, setDeferredSelection] = useState<{ id: string; type: EditorObjectType } | null>(null)

  // Create mode
  const [isCreating, setIsCreating] = useState(false)
  const [createType, setCreateType] = useState<NoteType>('topic-note')
  const [createInitialDate, setCreateInitialDate] = useState<string | undefined>(undefined)
  const [createKey, setCreateKey] = useState(0)
  const [createHasUnsavedChanges, setCreateHasUnsavedChanges] = useState(false)
  const [confirmCloseTarget, setConfirmCloseTarget] = useState<'create' | 'active-object' | null>(null)

  // Inbox filter
  const [showInbox, setShowInbox] = useState(false)

  // Board filter
  const [boardFilter, setBoardFilter] = useState('')
  const [boardSort, setBoardSort] = useState<BoardSort>('recent')
  const [visibleObjectTypes, setVisibleObjectTypes] = useState<LibraryObjectFilterType[]>(DEFAULT_VISIBLE_LIBRARY_TYPES)
  const [fileListWidth, setFileListWidth] = useState(LIBRARY_LIST_DEFAULT_WIDTH)
  const [isResizingFileList, setIsResizingFileList] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const mediaQuery = window.matchMedia('(max-width: 899px)')
    const update = () => setIsSmallScreen(mediaQuery.matches)
    update()

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', update)
      return () => mediaQuery.removeEventListener('change', update)
    }

    mediaQuery.addListener(update)
    return () => mediaQuery.removeListener(update)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const raw = window.localStorage.getItem(LIBRARY_LIST_WIDTH_STORAGE_KEY)
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
    if (!Number.isFinite(parsed)) return
    setFileListWidth(clampLibraryListWidth(parsed))
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(LIBRARY_LIST_WIDTH_STORAGE_KEY, String(fileListWidth))
  }, [fileListWidth])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!activeObject || isSmallScreen) return

    const clampToContainer = () => {
      const containerWidth = listRowRef.current?.getBoundingClientRect().width
      setFileListWidth((prev) => clampLibraryListWidth(prev, containerWidth))
    }

    clampToContainer()
    window.addEventListener('resize', clampToContainer)
    return () => window.removeEventListener('resize', clampToContainer)
  }, [activeObject, isSmallScreen])

  const handleFileListResizeStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!activeObject || isSmallScreen) return

    event.preventDefault()
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    setIsResizingFileList(true)

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const containerRect = listRowRef.current?.getBoundingClientRect()
      const containerWidth = containerRect?.width
      const nextWidth = containerRect
        ? moveEvent.clientX - containerRect.left
        : moveEvent.clientX

      setFileListWidth(clampLibraryListWidth(nextWidth, containerWidth))
    }

    const handleMouseUp = () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      setIsResizingFileList(false)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [activeObject, isSmallScreen])

  const visibleObjectTypeSet = useMemo(() => new Set(visibleObjectTypes), [visibleObjectTypes])
  const isObjectTypeFilterCustomized = useMemo(
    () => LIBRARY_OBJECT_TYPE_OPTIONS.some((option) => visibleObjectTypeSet.has(option.value) !== option.checkedByDefault),
    [visibleObjectTypeSet],
  )

  const toggleObjectTypeVisibility = useCallback((type: LibraryObjectFilterType) => {
    setVisibleObjectTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return LIBRARY_OBJECT_TYPE_OPTIONS
        .map((option) => option.value)
        .filter((value) => next.has(value))
    })
  }, [])

  const isTagFilterCustomized = hasActiveTagFilters(tagFilters)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [topicsRes, dailiesRes, habitsRes, filesRes, scriptureRes] = await Promise.allSettled([
        listTopicNoteMeta(),
        listDailyNoteMeta(),
        listHabitMeta(),
        listFileMeta(),
        listScriptureMeta(),
      ])
      if (topicsRes.status === 'fulfilled')
        setTopicNotes(topicsRes.value as TopicItem[])
      if (dailiesRes.status === 'fulfilled')
        setDailyNotes(dailiesRes.value as DailyItem[])
      if (habitsRes.status === 'fulfilled')
        setHabits(habitsRes.value as HabitItem[])
      if (filesRes.status === 'fulfilled')
        setFiles(filesRes.value as FileItem[])
      if (scriptureRes.status === 'fulfilled')
        setScriptures(scriptureRes.value as ScriptureItem[])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const openObjectInPanel = useCallback(async (
    objectId: string,
    type: EditorObjectType,
    options?: { skipDirtyCheck?: boolean },
  ): Promise<boolean> => {
    if (!options?.skipDirtyCheck && activeObject?.isDirty && (activeObject.objectId !== objectId || activeObject.type !== type)) {
      setDeferredSelection({ id: objectId, type })
      setConfirmCloseTarget('active-object')
      return false
    }

    if (activeObject?.objectId === objectId && activeObject.type === type) {
      setIsCreating(false)
      return true
    }

    let loadedObject: Record<string, unknown> | null = null
    try {
      const full = await getObject(type, objectId)
      loadedObject = { ...(full as unknown as Record<string, unknown>), type }
    } catch {
      if (type === 'habit') {
        const habitsMeta = await listHabitMeta()
        const fallback = habitsMeta.find((item) => item.id === objectId)
        if (fallback) {
          try {
            const fullFallback = await getObject('habit', fallback.id)
            loadedObject = { ...(fullFallback as unknown as Record<string, unknown>), type: 'habit' }
          } catch {
            loadedObject = { ...fallback, type: 'habit' }
          }
        }
      }
    }

    if (!loadedObject) return false
    setIsCreating(false)
    setDeferredSelection(null)
    setActiveObject({ objectId, type, object: loadedObject as Record<string, unknown>, isDirty: false })
    return true
  }, [activeObject])

  const handleSelectItem = useCallback(async (id: string, type: EditorObjectType) => {
    await openObjectInPanel(id, type)
  }, [openObjectInPanel])

  useEffect(() => {
    if (!pendingSelection) return
    let cancelled = false

    void (async () => {
      try {
        await handleSelectItem(pendingSelection.id, pendingSelection.type)
      } finally {
        if (!cancelled) {
          onPendingSelectionHandled?.(pendingSelection.nonce)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [handleSelectItem, onPendingSelectionHandled, pendingSelection])

  const handleNavigateToObject = useCallback(async (target: ResolvedObjectRef) => {
    const opened = await openObjectInPanel(target.id, target.type)
    if (opened) return

    if (target.type === 'habit') {
      const habitsMeta = await listHabitMeta()
      const targetPath = normalizePathForLookup(target.syncPath ?? target.syncPath)
      const fallback = habitsMeta.find((item) => item.id === target.id)
        ?? habitsMeta.find((item) => normalizePathForLookup(item.syncPath ?? item.syncPath) === targetPath)
      if (fallback) {
        void openObjectInPanel(fallback.id, 'habit')
      }
    }
  }, [openObjectInPanel])

  const handleStartCreate = useCallback((type: NoteType, initialDate?: string) => {
    setCreateType(type)
    setCreateInitialDate(initialDate)
    setIsCreating(true)
    setCreateHasUnsavedChanges(false)
    setCreateKey((k) => k + 1)
  }, [])

  useEffect(() => {
    if (!pendingCreate) return
    let cancelled = false

    void (async () => {
      try {
        if (pendingCreate.type === 'daily-note' && pendingCreate.date) {
          const existing = dailyNotes.find((note) => note.date === pendingCreate.date)
          if (existing) {
            await openObjectInPanel(existing.id, 'daily-note')
            return
          }
        }

        handleStartCreate(pendingCreate.type, pendingCreate.date)
      } finally {
        if (!cancelled) {
          onPendingCreateHandled?.(pendingCreate.nonce)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [dailyNotes, handleStartCreate, onPendingCreateHandled, openObjectInPanel, pendingCreate])

  const handleCreateDateChange = useCallback(async (date: string) => {
    if (!isCreating || createType !== 'daily-note') return
    const existing = dailyNotes.find((note) => note.date === date)
    if (!existing) return

    await openObjectInPanel(existing.id, 'daily-note')
    setCreateHasUnsavedChanges(false)
  }, [createType, dailyNotes, isCreating, openObjectInPanel])

  const handleSaveNew = (saved: Record<string, unknown>) => {
    const type = (saved.type as EditorObjectType | undefined) ?? createType
    const id = saved.id as string | undefined
    setCreateHasUnsavedChanges(false)
    setIsCreating(false)
    loadAll()
    if (id) {
      void openObjectInPanel(id, type, { skipDirtyCheck: true })
    }
    onSaved?.()
  }

  const handleSaveEdit = (saved: Record<string, unknown>) => {
    const id = saved.id as string | undefined
    const type = saved.type as EditorObjectType | undefined
    if (id && type) {
      setActiveObject((prev) => (prev
        ? { ...prev, objectId: id, type, object: { ...saved, type }, isDirty: false }
        : prev
      ))
    }
    loadAll()
  }

  const handleRequestCloseEditor = useCallback(() => {
    if (!activeObject) return
    if (activeObject.isDirty) {
      setConfirmCloseTarget('active-object')
      return
    }
    setActiveObject(null)
  }, [activeObject])

  const handleCloseEditor = () => {
    if (isCreating) {
      if (createHasUnsavedChanges) {
        setConfirmCloseTarget('create')
        return
      }
      setIsCreating(false)
      setCreateHasUnsavedChanges(false)
      return
    }
    if (!activeObject) return
    handleRequestCloseEditor()
  }

  const handleConfirmClose = () => {
    if (confirmCloseTarget === 'create') {
      setIsCreating(false)
      setCreateHasUnsavedChanges(false)
      setConfirmCloseTarget(null)
      setDeferredSelection(null)
      return
    }

    const nextSelection = deferredSelection
    setActiveObject(null)
    setDeferredSelection(null)
    setConfirmCloseTarget(null)
    if (nextSelection) {
      void openObjectInPanel(nextSelection.id, nextSelection.type, { skipDirtyCheck: true })
    }
  }

   // Unified card list
  const hasInboxTag = (tags: string[]) => tags.some((t) => String(t ?? '').trim().toLowerCase() === 'inbox')
  const isInboxEligibleCardType = (type: BoardCard['type']) => (
    type === 'topic-note'
    || type === 'daily-note'
    || type === 'habit'
    || type === 'project'
    || type === 'ref-material'
  )
  const effectiveVisibleObjectTypeSet = useMemo(() => {
    if (showInbox) {
      return new Set<LibraryObjectFilterType>(LIBRARY_OBJECT_TYPE_OPTIONS.map((option) => option.value))
    }
    // If the user has somehow ended up with zero selected types, fall back to
    // the default set so the library doesn't appear empty with no recourse.
    if (visibleObjectTypeSet.size === 0) {
      return new Set<LibraryObjectFilterType>(DEFAULT_VISIBLE_LIBRARY_TYPES)
    }
    return visibleObjectTypeSet
  }, [showInbox, visibleObjectTypeSet])
  const hasActiveBoardFilters = isObjectTypeFilterCustomized || isTagFilterCustomized
  const allCards = useMemo((): BoardCard[] => {
    const normalizedBoardFilter = normalizeSearchQuery(boardFilter)
    const topicCards: BoardCard[] = topicNotes
      .filter((n) => !showInbox || hasInboxTag(n.tags))
      .map((n): BoardCard | null => {
        const title = deriveTopicCardTitle(n.title, n.preview, n.date)
        const snippet = sanitizeCardPreview(n.preview) || undefined
        const hasMeaningfulTopicContent = Boolean(title || snippet || n.date)
        if (!hasMeaningfulTopicContent) return null

        return {
          id: n.id,
          type: 'topic-note' as NoteType,
          title,
          metadata: n.date ? formatDatePretty(n.date) : undefined,
          metadataAccent: Boolean(n.date),
          snippet,
          tags: n.tags,
          sortTimestamp: toSortTimestamp(n.updatedAt, n.date),
        }
      })
      .filter((card): card is BoardCard => Boolean(card))

    const dailyCards: BoardCard[] = dailyNotes
      .filter((n) => !showInbox || hasInboxTag(n.tags))
      .map((n) => ({
        id: n.id,
        type: 'daily-note' as NoteType,
        title: formatDatePretty(n.date),
        weekdayLabel: formatWeekdayFull(n.date),
        snippet: sanitizeCardPreview(n.preview) || undefined,
        tags: n.tags,
        sortTimestamp: toSortTimestamp(n.date),
      }))

    const habitCards: BoardCard[] = habits
      .filter((n) => !showInbox || hasInboxTag(n.tags))
      .map((n) => ({
        id: n.id,
        type: 'habit' as NoteType,
        title: deriveHabitCardTitle(n.tags, n.date, n.text),
        weekdayLabel: n.date ? formatWeekdayFull(n.date) : undefined,
        snippet: sanitizeCardPreview(n.text) || undefined,
        tags: n.tags,
        hideTags: true,
        sortTimestamp: toSortTimestamp(n.date),
      }))

    const fileCards: BoardCard[] = files
      .filter((f) => !showInbox || hasInboxTag(f.tags))
      .map((f) => ({
        id: f.id,
        type: f.type,
        title: f.name || (f.type === 'project' ? 'Project' : 'Reference Material'),
        metadata: f.type === 'project'
          ? (f.startDate ? formatDatePretty(f.startDate) : undefined)
          : (f.author ? `by ${f.author}` : undefined),
        metadataAccent: f.type === 'project' && Boolean(f.startDate),
        snippet: undefined,
        tags: f.tags,
        sortTimestamp: toSortTimestamp(f.startDate),
      }))

    const scriptureCards: BoardCard[] = scriptures
      .map((s) => ({
        id: s.id,
        type: 'scripture' as const,
        title: s.reference || 'Scripture',
        metadata: s.noteCount === 1 ? '1 linked note' : `${s.noteCount} linked notes`,
        snippet: undefined,
        tags: [],
        sortTimestamp: 0,
      }))

    const tagCountMap = new Map<string, number>()
    for (const card of [...topicCards, ...dailyCards, ...habitCards, ...fileCards]) {
      for (const tag of card.tags ?? []) {
        const normalizedTag = String(tag ?? '').trim().toLowerCase()
        if (!normalizedTag) continue
        tagCountMap.set(normalizedTag, (tagCountMap.get(normalizedTag) ?? 0) + 1)
      }
    }
    const tagCards: BoardCard[] = [...tagCountMap.entries()].map(([tag, count]) => ({
      id: tag,
      type: 'tag' as const,
      title: `#${tag}`,
      metadata: count === 1 ? '1 object' : `${count} objects`,
      tags: [tag],
      sortTimestamp: count,
    }))

    const cards = [...topicCards, ...dailyCards, ...habitCards, ...fileCards, ...scriptureCards, ...tagCards].filter((card) => {
      if (!cardMatchesSearch(card, normalizedBoardFilter)) return false
      if (!effectiveVisibleObjectTypeSet.has(card.type)) return false

      if (showInbox) {
        return isInboxEligibleCardType(card.type) && hasInboxTag(card.tags ?? [])
      }

      if (!itemMatchesTagFilters(card.tags, tagFilters)) return false

      return true
    })

    const compareByTitle = (a: BoardCard, b: BoardCard) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
    if (boardSort === 'title-asc') return cards.sort(compareByTitle)
    if (boardSort === 'title-desc') return cards.sort((a, b) => compareByTitle(b, a))
    if (boardSort === 'oldest') return cards.sort((a, b) => a.sortTimestamp - b.sortTimestamp || compareByTitle(a, b))
    return cards.sort((a, b) => b.sortTimestamp - a.sortTimestamp || compareByTitle(a, b))
  }, [topicNotes, dailyNotes, habits, files, scriptures, showInbox, boardFilter, boardSort, tagFilters, effectiveVisibleObjectTypeSet])
  const activeNoteType = activeObject?.type ?? null
  const activeNoteId = activeObject?.objectId ?? null
  const isGalleryMode = !activeObject
  const resultsLabel = allCards.length === 1 ? '1 item' : `${allCards.length} items`
  const getObjectPanelLabel = (item: ActiveLibraryObject) => {
    if (item.type === 'daily-note') {
      const value = item.object.date as string | undefined
      return value ? formatDatePretty(value) : 'Daily Note'
    }
    if (item.type === 'habit') {
      const tags = Array.isArray(item.object.tags) ? item.object.tags as string[] : []
      const date = String(item.object.date ?? '').trim()
      const text = String(item.object.text ?? '').trim()
      return deriveHabitCardTitle(tags, date, text)
    }
    if (item.type === 'project') {
      return (item.object.name as string | undefined)?.trim() || 'Project'
    }
    if (item.type === 'ref-material') {
      return (item.object.name as string | undefined)?.trim() || 'Reference Material'
    }
    if (item.type === 'scripture') {
      return (item.object.reference as string | undefined)?.trim() || 'Scripture'
    }
    if (item.type === 'tag') {
      const display = (item.object.displayName as string | undefined)?.trim() || (item.object.name as string | undefined)?.trim()
      return display ? `#${display}` : 'Tag'
    }
    return (item.object.title as string | undefined)?.trim() || 'Topic Note'
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden pl-1.5">
      <div className="ui-toolbar-panel mb-2 flex flex-wrap items-center gap-2 px-4 pb-1.5 pt-0" style={{ borderBottom: 'none' }}>
        <TooltipProvider>
          <Tooltip>
            <DropdownMenu>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Create a new object"
                    className="h-10 w-10 rounded-[10px]"
                  >
                    <SquarePen className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuItem onSelect={() => handleStartCreate('topic-note')}>
                  <span className="flex flex-col gap-0.5">
                    <span className="flex items-center gap-2">
                      <NotebookPen className="h-4 w-4" />
                      Topic Note
                    </span>
                    <span className="pl-6 text-xs text-[var(--color-text-disabled)]">Create a titled note</span>
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleStartCreate('daily-note')}>
                  <span className="flex flex-col gap-0.5">
                    <span className="flex items-center gap-2">
                      <CalendarDays className="h-4 w-4" />
                      Daily Note
                    </span>
                    <span className="pl-6 text-xs text-[var(--color-text-disabled)]">Create or open a dated daily note</span>
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleStartCreate('habit')}>
                  <span className="flex flex-col gap-0.5">
                    <span className="flex items-center gap-2">
                      <Repeat2 className="h-4 w-4" />
                      Habit
                    </span>
                    <span className="pl-6 text-xs text-[var(--color-text-disabled)]">Create a dated habit entry</span>
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <TooltipContent>Create a new object</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <Button
          size="icon"
          variant={showInbox ? 'outline' : 'ghost'}
          onClick={() => setShowInbox((v) => !v)}
          title={showInbox ? 'Show all notes' : 'Show Inbox only'}
          className={showInbox ? 'h-10 w-10 rounded-[10px] border-[rgba(242,203,99,0.18)] bg-[var(--color-selected-fill-soft)] text-[var(--color-text-primary)]' : 'h-10 w-10 rounded-[10px]'}
        >
          <Inbox className="h-[18px] w-[18px]" />
        </Button>

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
              {LIBRARY_OBJECT_TYPE_OPTIONS.map((option) => {
                const checked = visibleObjectTypeSet.has(option.value)
                return (
                  <DropdownMenuCheckboxItem
                    key={option.value}
                    checked={checked}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={() => toggleObjectTypeVisibility(option.value)}
                  >
                    {option.label}
                  </DropdownMenuCheckboxItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          <Select value={boardSort} onValueChange={(value) => setBoardSort(value as BoardSort)}>
            <SelectTrigger aria-label="Sort notes" className="h-10 w-[168px] rounded-[10px] border-[var(--color-border-subtle)] bg-[var(--color-surface-control)]/88 text-xs text-[var(--color-text-primary)]">
              <span className="flex items-center gap-2">
                <ArrowUpDown className="h-3.5 w-3.5 text-[var(--color-text-disabled)]" />
                <SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">{BOARD_SORT_LABELS.recent}</SelectItem>
              <SelectItem value="oldest">{BOARD_SORT_LABELS.oldest}</SelectItem>
              <SelectItem value="title-asc">{BOARD_SORT_LABELS['title-asc']}</SelectItem>
              <SelectItem value="title-desc">{BOARD_SORT_LABELS['title-desc']}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="relative ml-auto w-[248px] max-w-full min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-disabled)]" />
          <Input
            placeholder="Search"
            value={boardFilter}
            onChange={(e) => setBoardFilter(e.target.value)}
            className="h-10 w-full rounded-[10px] pr-4 text-sm"
            style={{ paddingLeft: '2.5rem' }}
          />
        </div>
      </div>

      <div
        ref={listRowRef}
        className={`flex min-h-0 w-full min-w-0 gap-1.5 ${activeObject && !isSmallScreen ? 'flex-row' : 'flex-col'}`}
      >
        <div
          className="flex min-h-0 min-w-0 flex-col"
          style={activeObject && !isSmallScreen ? { width: fileListWidth, minWidth: LIBRARY_LIST_MIN_WIDTH, flex: '0 0 auto' } : undefined}
        >
          <div className="ui-shell-panel relative flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--color-surface-app)]">
            {activeObject && !isSmallScreen ? (
              <div
                onMouseDown={handleFileListResizeStart}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize file list"
                className="absolute right-0 top-0 z-[2] h-full w-[6px] cursor-col-resize"
              >
                <div
                  className="absolute right-[2px] top-0 h-full w-px transition-colors"
                  style={{ backgroundColor: isResizingFileList ? 'rgba(243, 239, 231, 0.95)' : 'transparent' }}
                />
              </div>
            ) : null}

            <div className="ui-scroller flex-1 overflow-auto px-3 py-2">
              {loading ? (
                <div className="flex h-full min-h-[240px] items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-[var(--color-text-secondary)]" />
                </div>
              ) : allCards.length === 0 ? (
                <div className="flex min-h-[240px] items-center justify-center rounded-[16px] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)]/80 px-6 py-8 text-center text-sm text-[var(--color-text-secondary)]">
                  {boardFilter || showInbox || hasActiveBoardFilters ? 'No matches found for the current filters.' : 'Nothing here yet.'}
                </div>
              ) : isGalleryMode ? (
                <div
                  className="mx-auto w-full"
                  style={{
                    columnWidth: '272px',
                    columnGap: '12px',
                    maxWidth: '100%',
                  }}
                >
                  {allCards.map((card) => {
                    const isOpenable = card.type === 'topic-note' || card.type === 'daily-note' || card.type === 'habit' || card.type === 'project' || card.type === 'ref-material' || card.type === 'scripture' || card.type === 'tag'
                    return (
                      <div
                        key={`${card.type}:${card.id}`}
                        className="w-full break-inside-avoid inline-block"
                        style={{ marginBottom: '14px' }}
                      >
                        <NoteCard
                          card={card}
                          isSelected={activeNoteId === card.id && activeNoteType === card.type}
                          onClick={isOpenable ? () => { void handleSelectItem(card.id, card.type as EditorObjectType) } : undefined}
                          title={isOpenable ? 'Click to open in the detail pane' : undefined}
                        />
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="mx-auto flex w-full max-w-[960px] flex-col" style={{ gap: '14px' }}>
                  {allCards.map((card) => {
                    const isOpenable = card.type === 'topic-note' || card.type === 'daily-note' || card.type === 'habit' || card.type === 'project' || card.type === 'ref-material' || card.type === 'scripture' || card.type === 'tag'
                    return (
                      <NoteCard
                        key={`${card.type}:${card.id}`}
                        card={card}
                        isSelected={activeNoteId === card.id && activeNoteType === card.type}
                        onClick={isOpenable ? () => { void handleSelectItem(card.id, card.type as EditorObjectType) } : undefined}
                        title={isOpenable ? 'Click to open in the detail pane' : undefined}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="px-3 pb-1 pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="pb-[3px] text-xs text-[var(--color-text-secondary)]">{resultsLabel}</div>
              {showInbox && (
                <div className="inline-flex items-center gap-2 rounded-[12px] border border-[rgba(242,203,99,0.16)] bg-[var(--color-selected-fill-soft)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)]">
                  <Inbox className="h-3.5 w-3.5 text-[var(--color-accent-metadata)]" />
                  Inbox only — imported items tagged Inbox
                </div>
              )}
            </div>
          </div>
        </div>

        {activeObject && (
          <section className="flex min-h-0 min-w-[420px] flex-1 flex-col overflow-hidden rounded-[18px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)]">
            <>
              <div className="flex min-h-[72px] items-center border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] px-2.5 py-3.5">
                <div className="min-w-0 flex-1 px-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--color-text-disabled)]">
                    Open item
                  </div>
                  <div className={cn('mt-1 truncate text-lg font-semibold text-[var(--color-text-primary)] leading-[1.2]', activeObject.type === 'tag' || activeObject.type === 'habit' ? 'ui-tag-text' : undefined)}>
                    {getObjectPanelLabel(activeObject)}
                  </div>
                </div>
                {activeObject.isDirty ? (
                  <div className="inline-flex items-center rounded-full border border-[rgba(242,203,99,0.22)] bg-[var(--color-selected-fill-soft)] px-2.5 py-1 text-xs leading-none text-[var(--color-text-secondary)]">
                    Unsaved
                  </div>
                ) : null}
                <Button variant="ghost" size="icon" onClick={handleCloseEditor} className="h-9 w-9 rounded-[10px] text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)]">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex min-h-0 flex-1 overflow-hidden p-0">
                {activeObject ? (
                  <EditorErrorBoundary>
                    {activeObject.type === 'scripture' || activeObject.type === 'tag' ? (
                      <ObjectMetaDetailPanel
                        object={activeObject.object}
                        type={activeObject.type}
                        flatTop
                        onNavigateToObject={handleNavigateToObject}
                      />
                    ) : (
                      <ObjectEditor
                        key={`${activeObject.type}:${activeObject.objectId}`}
                        object={activeObject.object}
                        type={activeObject.type}
                        flatTop
                        onSave={handleSaveEdit}
                        onCancel={handleCloseEditor}
                        onDirty={(isDirty) => {
                          setActiveObject((prev) => (prev ? { ...prev, isDirty } : prev))
                        }}
                        onNavigateToObject={handleNavigateToObject}
                      />
                    )}
                  </EditorErrorBoundary>
                ) : null}
              </div>
            </>
          </section>
        )}
      </div>

      <Dialog open={isCreating} onOpenChange={(open) => { if (!open) handleCloseEditor() }}>
        <DialogContent
          className={isSmallScreen ? 'h-screen max-w-none rounded-none border-0 p-3' : 'flex h-[min(720px,calc(100vh-64px))] max-h-[calc(100vh-32px)] max-w-5xl flex-col p-4'}
          aria-labelledby="create-object-dialog-title"
          aria-label="Create New Note"
        >
          <DialogHeader>
            <DialogTitle id="create-object-dialog-title">Create New Note</DialogTitle>
            <DialogDescription>
              Choose a note type and fill out the editor to create a new object.
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1">
            <CreatePanel
              createType={createType}
              initialDate={createInitialDate}
              createKey={createKey}
              onTypeChange={(t) => {
                setCreateType(t)
                setCreateKey((k) => k + 1)
              }}
              onSave={handleSaveNew}
              onClose={handleCloseEditor}
              onDirty={setCreateHasUnsavedChanges}
              onNavigateToObject={handleNavigateToObject}
              onCreateDateChange={handleCreateDateChange}
              showHeader={false}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog for unsaved changes */}
      <Dialog open={!!confirmCloseTarget} onOpenChange={(open) => { if (!open) { setConfirmCloseTarget(null); setDeferredSelection(null) } }}>
        {confirmCloseTarget ? (
          <DialogContent className="max-w-sm" aria-label="Unsaved Changes">
            <DialogHeader>
              <DialogTitle>Unsaved Changes</DialogTitle>
              <DialogDescription>
                You have unsaved changes. Are you sure you want to close without saving?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setConfirmCloseTarget(null); setDeferredSelection(null) }}>Cancel</Button>
              <Button onClick={handleConfirmClose} variant="destructive">
                Discard Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
      </div>
   )
}
