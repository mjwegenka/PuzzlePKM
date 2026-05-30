import React, { useState, useEffect, useCallback, useDeferredValue, useMemo, useRef } from 'react'
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
import { Textarea } from '../ui/textarea'

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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import {
  deleteObject,
  getObject,
  listHabitMeta,
  listMetaBundle,
  rankSearchCandidates,
  writeObject,
  type ResolvedObjectRef,
} from '@/lib/cliService'
import { formatDatePretty, formatWeekdayFull, getTodayDate } from '@/lib/dateUtils'
import { getObjectDisplayTitle } from '@/lib/objectTypeDefinitions'
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
type EditableObjectType = Exclude<EditorObjectType, 'scripture' | 'tag'>

interface LibraryPageProps {
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
  contentSearch?: string
  date?: string
  updatedAt: string
  tags: string[]
  displayTitle: string
  type: 'topic-note'
}

interface DailyItem {
  id: string
  date: string
  preview: string
  contentSearch?: string
  tags: string[]
  displayTitle: string
  type: 'daily-note'
}

interface HabitItem {
  id: string
  date: string
  text: string
  contentSearch?: string
  tags: string[]
  displayTitle: string
  type: 'habit'
}

interface FileItem {
  id: string
  name: string
  author?: string
  syncPath: string
  startDate?: string
  tags: string[]
  displayTitle: string
  type: 'project' | 'ref-material'
}

interface ScriptureItem {
  id: string
  reference: string
  passageUrl: string
  noteCount: number
  displayTitle: string
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
  contentSearch?: string
  date?: string
  author?: string
}

interface RenderedBoardCard {
  key: string
  card: BoardCard
  phase: 'entering' | 'present' | 'exiting'
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
function getBoardCardKey(card: Pick<BoardCard, 'id' | 'type'>): string {
  return `${card.type}:${card.id}`
}

function clampLibraryListWidth(width: number, containerWidth?: number): number {
  const maxFromContainer = typeof containerWidth === 'number'
    ? Math.max(LIBRARY_LIST_MIN_WIDTH, containerWidth - LIBRARY_DETAIL_MIN_WIDTH - LIBRARY_COLUMN_GAP_PX)
    : Number.POSITIVE_INFINITY

  return Math.min(maxFromContainer, Math.max(LIBRARY_LIST_MIN_WIDTH, width))
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

function toSortTimestamp(...values: Array<string | undefined>): number {
  for (const value of values) {
    const timestamp = Date.parse(String(value ?? ''))
    if (!Number.isNaN(timestamp)) return timestamp
  }
  return 0
}

function isEditableBulkCardType(type: BoardCard['type']): type is Extract<BoardCard['type'], 'topic-note' | 'daily-note' | 'habit' | 'project' | 'ref-material'> {
  return type === 'topic-note' || type === 'daily-note' || type === 'habit' || type === 'project' || type === 'ref-material'
}

function isBulkDeletableCardType(type: BoardCard['type']): type is Extract<BoardCard['type'], 'topic-note' | 'daily-note' | 'habit'> {
  return type === 'topic-note' || type === 'daily-note' || type === 'habit'
}

function parseBulkTags(rawValue: string): string[] {
  return String(rawValue)
    .split(/[\n,]/g)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => tag.replace(/^#/, '').toLowerCase())
    .filter((tag, index, all) => all.indexOf(tag) === index)
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select'
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  const maxWorkers = Math.max(1, Math.min(concurrency, items.length))
  let index = 0

  const workers = Array.from({ length: maxWorkers }, async () => {
    while (index < items.length) {
      const current = items[index]
      index += 1
      await worker(current)
    }
  })

  await Promise.all(workers)
}

// ── Create panel (type selector + blank editor) ───────────────────────────────

interface CreatePanelProps {
  createType: NoteType
  initialDate?: string
  createKey: number
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
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* Panel header — matches open-item header chrome */}
      {showHeader ? (
        <div className="flex min-h-[72px] shrink-0 items-center border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] px-2.5 py-3.5">
          <div className="min-w-0 flex-1 px-2">
            <div className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--color-text-disabled)]">
              {createType === 'topic-note' ? 'New Topic Note' : createType === 'daily-note' ? 'New Daily Note' : 'New Habit'}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-9 w-9 rounded-[10px] text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)]">
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : null}

      {/* Blank editor fills remaining space */}
      <div className="flex min-h-0 flex-1 overflow-hidden p-0">
        <ObjectEditor
          key={createKey}
          object={blankObject}
          type={createType}
          flatTop
          onSave={onSave}
          onCancel={onClose}
          onDirty={onDirty}
          onNavigateToObject={onNavigateToObject}
          onDateChange={createType === 'daily-note' ? onCreateDateChange : undefined}
        />
      </div>
    </div>
  )

}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LibraryPage({
  onSaved,
  pendingSelection,
  onPendingSelectionHandled,
  pendingCreate,
  onPendingCreateHandled,
  tagFilters = {},
}: LibraryPageProps) {
  const listRowRef = useRef<HTMLDivElement | null>(null)
  const listScrollerRef = useRef<HTMLDivElement | null>(null)
  const pendingScrollRestoreRef = useRef<number | null>(null)
  const latestLoadRequestRef = useRef(0)
  const cardMotionTimeoutsRef = useRef<number[]>([])
  const [isSmallScreen, setIsSmallScreen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 900 : false))
  const [topicNotes, setTopicNotes] = useState<TopicItem[]>([])
  const [dailyNotes, setDailyNotes] = useState<DailyItem[]>([])
  const [habits, setHabits] = useState<HabitItem[]>([])
  const [files, setFiles] = useState<FileItem[]>([])
  const [scriptures, setScriptures] = useState<ScriptureItem[]>([])
  const [loading, setLoading] = useState(false)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const [activeObject, setActiveObject] = useState<ActiveLibraryObject | null>(null)
  const [deferredSelection, setDeferredSelection] = useState<{ id: string; type: EditorObjectType } | null>(null)
  const [pendingBlockId, setPendingBlockId] = useState<string | undefined>(undefined)

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
  const deferredBoardFilter = useDeferredValue(boardFilter)
  const [boardSort, setBoardSort] = useState<BoardSort>('recent')
  const [visibleObjectTypes, setVisibleObjectTypes] = useState<LibraryObjectFilterType[]>(DEFAULT_VISIBLE_LIBRARY_TYPES)
  const [fileListWidth, setFileListWidth] = useState(LIBRARY_LIST_DEFAULT_WIDTH)
  const [isResizingFileList, setIsResizingFileList] = useState(false)
  const [renderedCards, setRenderedCards] = useState<RenderedBoardCard[]>([])
  const [selectedCardKeys, setSelectedCardKeys] = useState<string[]>([])
  const selectionAnchorKeyRef = useRef<string | null>(null)
  const [showBulkTagDialog, setShowBulkTagDialog] = useState(false)
  const [bulkTagInput, setBulkTagInput] = useState('')
  const [bulkTagError, setBulkTagError] = useState<string | null>(null)
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false)
  const [bulkActionError, setBulkActionError] = useState<string | null>(null)
  const [isBulkSaving, setIsBulkSaving] = useState(false)

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
    if ((!activeObject && !isCreating) || isSmallScreen) return

    const clampToContainer = () => {
      const containerWidth = listRowRef.current?.getBoundingClientRect().width
      setFileListWidth((prev) => clampLibraryListWidth(prev, containerWidth))
    }

    clampToContainer()
    window.addEventListener('resize', clampToContainer)
    return () => window.removeEventListener('resize', clampToContainer)
  }, [activeObject, isCreating, isSmallScreen])

  const handleFileListResizeStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if ((!activeObject && !isCreating) || isSmallScreen) return

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
  }, [activeObject, isCreating, isSmallScreen])

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
    const requestId = latestLoadRequestRef.current + 1
    latestLoadRequestRef.current = requestId

    if (hasLoadedOnce) {
      setIsRefreshing(true)
    } else {
      setLoading(true)
    }

    try {
      const bundle = await listMetaBundle()
      if (latestLoadRequestRef.current !== requestId) return

      setTopicNotes(bundle.topicNotes as TopicItem[])
      setDailyNotes(bundle.dailyNotes as DailyItem[])
      setHabits(bundle.habits as HabitItem[])
      setFiles(bundle.files as FileItem[])
      setScriptures(bundle.scriptures as ScriptureItem[])
      setHasLoadedOnce(true)
    } finally {
      if (latestLoadRequestRef.current === requestId) {
        setLoading(false)
        setIsRefreshing(false)
      }
    }
  }, [hasLoadedOnce])

  const captureListScrollForRestore = useCallback(() => {
    const node = listScrollerRef.current
    if (!node) return
    pendingScrollRestoreRef.current = node.scrollTop
  }, [])

  const isListReloading = loading || isRefreshing

  useEffect(() => {
    if (isListReloading) return
    const targetScrollTop = pendingScrollRestoreRef.current
    if (targetScrollTop == null) return
    const node = listScrollerRef.current
    pendingScrollRestoreRef.current = null
    if (!node) return

    // Wait until post-load render paints, then restore the previous offset.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        node.scrollTop = targetScrollTop
      })
    })
  }, [isListReloading])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  useEffect(() => {
    const handler = () => void loadAll();
    window.addEventListener('puzzlepkm:objects-updated', handler);
    return () => window.removeEventListener('puzzlepkm:objects-updated', handler);
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
    setPendingBlockId(target.blockId)
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
      const deleted = Boolean(saved.deleted)

      if (deleted) {
        captureListScrollForRestore()

        // Try to navigate to the next or previous object to stay in list view
        // DEC-65: After deletion, open the next object in the list if available,
        // otherwise open the previous object, keeping the user in list view
        // with their filters and scroll position preserved
        const currentIndex = activeObject
          ? editorNavigationCards.findIndex((card) => card.id === activeObject.objectId && card.type === activeObject.type)
          : -1

        let nextTarget = null
        if (currentIndex >= 0 && currentIndex < editorNavigationCards.length - 1) {
          nextTarget = editorNavigationCards[currentIndex + 1]
        } else if (currentIndex > 0) {
          nextTarget = editorNavigationCards[currentIndex - 1]
        }

        if (nextTarget) {
          // Open next/previous object and reload in parallel, then restore scroll
          void (async () => {
            await openObjectInPanel(nextTarget.id, nextTarget.type, { skipDirtyCheck: true })
            await loadAll()
          })()
        } else {
          // No adjacent objects - close editor and return to list view
          setActiveObject(null)
          void (async () => {
            await loadAll()
          })()
        }
        return
      }

      if (id && type) {
        setActiveObject((prev) => (prev
          ? { ...prev, objectId: id, type, object: { ...saved, type }, isDirty: false }
          : prev
        ))
      }
      void loadAll()
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
    const normalizedBoardFilter = normalizeSearchQuery(deferredBoardFilter)
    const topicCards: BoardCard[] = topicNotes
      .filter((n) => !showInbox || hasInboxTag(n.tags))
      .map((n): BoardCard | null => {
        const title = n.displayTitle
        const snippet = sanitizeCardPreview(n.preview) || undefined
        const hasMeaningfulTopicContent = Boolean(title || snippet || n.date)
        if (!hasMeaningfulTopicContent) return null

        return {
          id: n.id,
          type: 'topic-note' as NoteType,
          title,
          date: n.date,
          metadata: n.date ? formatDatePretty(n.date) : undefined,
          metadataAccent: Boolean(n.date),
          snippet,
          contentSearch: sanitizeCardPreview(n.contentSearch ?? n.preview) || undefined,
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
        title: n.displayTitle,
        date: n.date,
        weekdayLabel: formatWeekdayFull(n.date),
        snippet: sanitizeCardPreview(n.preview) || undefined,
        contentSearch: sanitizeCardPreview(n.contentSearch ?? n.preview) || undefined,
        tags: n.tags,
        sortTimestamp: toSortTimestamp(n.date),
      }))

    const habitCards: BoardCard[] = habits
      .filter((n) => !showInbox || hasInboxTag(n.tags))
      .map((n) => ({
        id: n.id,
        type: 'habit' as NoteType,
        title: n.displayTitle,
        date: n.date,
        weekdayLabel: n.date ? formatWeekdayFull(n.date) : undefined,
        snippet: sanitizeCardPreview(n.text) || undefined,
        contentSearch: sanitizeCardPreview(n.contentSearch ?? n.text) || undefined,
        tags: n.tags,
        hideTags: true,
        sortTimestamp: toSortTimestamp(n.date),
      }))

    const fileCards: BoardCard[] = files
      .filter((f) => !showInbox || hasInboxTag(f.tags))
      .map((f) => ({
        id: f.id,
        type: f.type,
        title: f.displayTitle,
        date: f.type === 'project' ? f.startDate : undefined,
        author: f.type === 'ref-material' ? f.author : undefined,
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
        title: s.displayTitle,
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
      if (!effectiveVisibleObjectTypeSet.has(card.type)) return false

      if (showInbox) {
        return isInboxEligibleCardType(card.type) && hasInboxTag(card.tags ?? [])
      }

      return itemMatchesTagFilters(card.tags, tagFilters)
    })

    if (normalizedBoardFilter) {
      const ranked = rankSearchCandidates(
        normalizedBoardFilter,
        cards.map((card, index) => ({
          id: getBoardCardKey(card),
          type: card.type,
          title: card.title,
          date: card.date,
          author: card.author,
          metadata: card.metadata,
          snippet: card.snippet,
          contentSearch: card.contentSearch,
          tags: card.tags,
          sourceOrder: index,
          typeOrder: card.type === 'project'
            ? 0
            : card.type === 'ref-material'
              ? 1
              : card.type === 'topic-note'
                ? 2
                : card.type === 'habit'
                  ? 3
                  : card.type === 'daily-note'
                    ? 4
                    : card.type === 'scripture'
                      ? 5
                      : 6,
          card,
        })),
      )
      return ranked.map((entry) => entry.item.card)
    }

    const compareByTitle = (a: BoardCard, b: BoardCard) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
    if (boardSort === 'title-asc') return cards.sort(compareByTitle)
    if (boardSort === 'title-desc') return cards.sort((a, b) => compareByTitle(b, a))
    if (boardSort === 'oldest') return cards.sort((a, b) => a.sortTimestamp - b.sortTimestamp || compareByTitle(a, b))
    return cards.sort((a, b) => b.sortTimestamp - a.sortTimestamp || compareByTitle(a, b))
  }, [topicNotes, dailyNotes, habits, files, scriptures, showInbox, deferredBoardFilter, boardSort, tagFilters, effectiveVisibleObjectTypeSet])

  useEffect(() => {
    cardMotionTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
    cardMotionTimeoutsRef.current = []

    setRenderedCards((previous) => {
      const previousByKey = new Map(previous.map((item) => [item.key, item]))
      const shouldAnimateEntries = previous.length > 0
      const nextCards: RenderedBoardCard[] = allCards.map((card) => {
        const key = getBoardCardKey(card)
        const existing = previousByKey.get(key)
        if (!existing) {
          return { key, card, phase: shouldAnimateEntries ? 'entering' : 'present' }
        }
        return {
          key,
          card,
          phase: 'present' as const,
        }
      })

      // In masonry/list filtering flows, keep the layout compact by dropping
      // removed cards immediately instead of reserving their previous slot.
      return nextCards
    })
  }, [allCards])

  useEffect(() => {
    return () => {
      cardMotionTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
    }
  }, [])

  const renderedCardKeys = useMemo(() => renderedCards.map(({ key }) => key), [renderedCards])
  const renderedCardKeySet = useMemo(() => new Set(renderedCardKeys), [renderedCardKeys])
  const selectedCardKeySet = useMemo(() => new Set(selectedCardKeys), [selectedCardKeys])
  const selectedRenderedCards = useMemo(
    () => renderedCards.filter(({ key }) => selectedCardKeySet.has(key)).map(({ card }) => card),
    [renderedCards, selectedCardKeySet],
  )
  const selectedEditableCards = useMemo(
    () => selectedRenderedCards.filter((card) => isEditableBulkCardType(card.type)),
    [selectedRenderedCards],
  )
  const selectedDeletableCards = useMemo(
    () => selectedRenderedCards.filter((card) => isBulkDeletableCardType(card.type)),
    [selectedRenderedCards],
  )
  const selectedCardCount = selectedCardKeys.length
  const selectedCardLabel = selectedCardCount === 1 ? '1 card selected' : `${selectedCardCount} cards selected`
  const canBulkEditTags = selectedEditableCards.length > 0
  const canBulkDelete = selectedCardCount > 0 && selectedDeletableCards.length === selectedCardCount

  useEffect(() => {
    if (selectedCardKeys.length === 0) return
    const nextSelected = selectedCardKeys.filter((key) => renderedCardKeySet.has(key))
    if (nextSelected.length === selectedCardKeys.length) return
    setSelectedCardKeys(nextSelected)
    if (nextSelected.length === 0) {
      selectionAnchorKeyRef.current = null
    } else if (selectionAnchorKeyRef.current && !renderedCardKeySet.has(selectionAnchorKeyRef.current)) {
      selectionAnchorKeyRef.current = nextSelected[0] ?? null
    }
  }, [renderedCardKeySet, selectedCardKeys])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        if (renderedCardKeys.length === 0) return
        event.preventDefault()
        setSelectedCardKeys(renderedCardKeys)
        selectionAnchorKeyRef.current = renderedCardKeys[0] ?? null
        return
      }

      if (event.key === 'Escape' && selectedCardKeys.length > 0) {
        event.preventDefault()
        setSelectedCardKeys([])
        selectionAnchorKeyRef.current = null
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [renderedCardKeys, selectedCardKeys.length])

  const clearCardSelection = useCallback(() => {
    setSelectedCardKeys([])
    selectionAnchorKeyRef.current = null
  }, [])

  const openBulkTagEditor = useCallback(() => {
    setBulkActionError(null)
    setBulkTagError(null)
    const normalizedCommonTags = selectedEditableCards.length > 0
      ? selectedEditableCards.reduce<string[]>((commonTags, card, index) => {
          const currentTags = parseBulkTags(card.tags?.join(', ') ?? '')
          if (index === 0) return currentTags
          return commonTags.filter((tag) => currentTags.includes(tag))
        }, [])
      : []
    setBulkTagInput(normalizedCommonTags.join(', '))
    setShowBulkTagDialog(true)
  }, [selectedEditableCards])

  const openBulkDeleteDialog = useCallback(() => {
    setBulkActionError(null)
    setShowBulkDeleteDialog(true)
  }, [])

  const handleCardSelectionGesture = useCallback((card: BoardCard, event: React.MouseEvent<HTMLElement>) => {
    const key = getBoardCardKey(card)
    const isModifierSelect = event.shiftKey || event.metaKey || event.ctrlKey
    if (!isModifierSelect) return false

    event.preventDefault()
    event.stopPropagation()

    setSelectedCardKeys((currentSelected) => {

      const nextSelection = currentSelected.includes(key)
        ? currentSelected.filter((existingKey) => existingKey !== key)
        : [...currentSelected, key]
      selectionAnchorKeyRef.current = key
      return nextSelection
    })

    return true
  }, [])

  const handleCardClick = useCallback(async (card: BoardCard, event: React.MouseEvent<HTMLElement>) => {
    if (handleCardSelectionGesture(card, event)) return

    if (selectedCardKeys.length > 0) {
      clearCardSelection()
    }

    await handleSelectItem(card.id, card.type as EditorObjectType)
  }, [clearCardSelection, handleCardSelectionGesture, handleSelectItem, selectedCardKeys.length])

  const activeObjectType = activeObject?.type
  const activeObjectId = activeObject?.objectId
  const activeObjectIsDirty = activeObject?.isDirty

  const handleApplyBulkTags = useCallback(async () => {
    const nextTags = parseBulkTags(bulkTagInput)
    const selectedCards = selectedEditableCards
    if (selectedCards.length === 0) {
      setBulkTagError('Select at least one card that supports tags.')
      return
    }
    if (selectedCards.some((card) => card.type === 'habit') && nextTags.length > 1) {
      setBulkTagError('Habits can only keep one tag. Reduce the list to one tag or fewer.')
      return
    }

    setBulkTagError(null)
    setBulkActionError(null)
    setIsBulkSaving(true)

    try {
      const savedByKey = new Map<string, Record<string, unknown>>()
      const failures: string[] = []

      await runWithConcurrency(selectedCards, 8, async (card) => {
        try {
          const saved = await writeObject(card.type, {
            id: card.id,
            tags: card.type === 'habit' ? nextTags.slice(0, 1) : nextTags,
          })
          savedByKey.set(getBoardCardKey(card), saved)
        } catch (error) {
          failures.push(`${card.type} ${card.id}: ${error instanceof Error ? error.message : String(error)}`)
        }
      })

      if (failures.length > 0) {
        setBulkTagError(failures.length === 1 ? failures[0] : `${failures[0]} (+${failures.length - 1} more)`)
        return
      }

      if (activeObjectType && activeObjectId && !activeObjectIsDirty) {
        const activeKey = `${activeObjectType}:${activeObjectId}`
        const updatedActive = savedByKey.get(activeKey)
        if (updatedActive) {
          setActiveObject((prev) => (prev ? { ...prev, object: { ...updatedActive, type: prev.type }, isDirty: false } : prev))
        }
      }

      await loadAll()
      clearCardSelection()
      setShowBulkTagDialog(false)
      onSaved?.()
    } catch (error) {
      setBulkTagError(error instanceof Error ? error.message : 'Failed to update tags for the selected cards.')
    } finally {
      setIsBulkSaving(false)
    }
  }, [activeObjectId, activeObjectIsDirty, activeObjectType, bulkTagInput, clearCardSelection, loadAll, onSaved, selectedEditableCards])

  const handleConfirmBulkDelete = useCallback(async () => {
    const selectedCards = selectedDeletableCards
    if (selectedCards.length === 0) {
      setBulkActionError('Select daily notes, topic notes, or habits to delete them in bulk.')
      return
    }

    setBulkActionError(null)
    setIsBulkSaving(true)

    try {
      for (const card of selectedCards) {
        await deleteObject(card.type, card.id)
        if (activeObject?.objectId === card.id && activeObject.type === card.type) {
          setActiveObject(null)
        }
      }

      await loadAll()
      clearCardSelection()
      setShowBulkDeleteDialog(false)
      onSaved?.()
    } catch (error) {
      setBulkActionError(error instanceof Error ? error.message : 'Failed to delete the selected cards.')
    } finally {
      setIsBulkSaving(false)
    }
  }, [activeObject?.objectId, activeObject?.type, clearCardSelection, loadAll, onSaved, selectedDeletableCards])

  const activeNoteType = activeObject?.type ?? null
  const activeNoteId = activeObject?.objectId ?? null
  const isGalleryMode = !activeObject
  const resultsLabel = allCards.length === 1 ? '1 item' : `${allCards.length} items`
  const editorNavigationCards = useMemo(() => (
    allCards.filter((card): card is BoardCard & { type: EditableObjectType } => (
      card.type === 'topic-note'
      || card.type === 'daily-note'
      || card.type === 'habit'
      || card.type === 'project'
      || card.type === 'ref-material'
    ))
  ), [allCards])
  const activeEditorNavigationIndex = useMemo(() => {
    if (!activeObject) return -1
    if (activeObject.type === 'scripture' || activeObject.type === 'tag') return -1
    return editorNavigationCards.findIndex((card) => card.id === activeObject.objectId && card.type === activeObject.type)
  }, [activeObject, editorNavigationCards])
  const previousEditorNavigationTarget = activeEditorNavigationIndex > 0
    ? editorNavigationCards[activeEditorNavigationIndex - 1]
    : null
  const nextEditorNavigationTarget = activeEditorNavigationIndex >= 0 && activeEditorNavigationIndex < editorNavigationCards.length - 1
    ? editorNavigationCards[activeEditorNavigationIndex + 1]
    : null
  const handleSaveAndOpenPrevious = useCallback(async () => {
    if (!previousEditorNavigationTarget) return
    await openObjectInPanel(previousEditorNavigationTarget.id, previousEditorNavigationTarget.type, { skipDirtyCheck: true })
  }, [openObjectInPanel, previousEditorNavigationTarget])
  const handleSaveAndOpenNext = useCallback(async () => {
    if (!nextEditorNavigationTarget) return
    await openObjectInPanel(nextEditorNavigationTarget.id, nextEditorNavigationTarget.type, { skipDirtyCheck: true })
  }, [nextEditorNavigationTarget, openObjectInPanel])
  const getObjectPanelLabel = (item: ActiveLibraryObject) => {
    return getObjectDisplayTitle(item.type, item.object)
  }

  const isCardOpenable = (cardType: BoardCard['type']): cardType is EditorObjectType => (
    cardType === 'topic-note'
    || cardType === 'daily-note'
    || cardType === 'habit'
    || cardType === 'project'
    || cardType === 'ref-material'
    || cardType === 'scripture'
    || cardType === 'tag'
  )

  const renderBoardCard = (entry: RenderedBoardCard, options?: { gallery?: boolean }) => {
    const { card, key, phase } = entry
    const gallery = Boolean(options?.gallery)
    const isOpenable = isCardOpenable(card.type)
    const isSelectedCard = selectedCardKeySet.has(key) || (activeNoteId === card.id && activeNoteType === card.type)

    return (
      <div
        key={key}
        data-motion-phase={phase}
        className={gallery ? 'library-card-motion w-full break-inside-avoid inline-block' : 'library-card-motion'}
        style={gallery ? { marginBottom: '14px' } : undefined}
      >
        <NoteCard
          card={card}
          isSelected={isSelectedCard}
          onClick={isOpenable ? (event) => { void handleCardClick(card, event) } : undefined}
          title={isOpenable ? 'Click to open. Shift-click or Cmd/Ctrl-click to select.' : undefined}
        />
      </div>
    )
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

      {selectedCardCount > 0 ? (
        <div className="mb-2 flex flex-wrap items-center gap-2 px-4 pb-1 text-xs text-[var(--color-text-secondary)]">
          <span className="inline-flex items-center rounded-full border border-[rgba(242,203,99,0.18)] bg-[var(--color-selected-fill-soft)] px-2.5 py-1 text-[var(--color-text-primary)]">
            {selectedCardLabel}
          </span>
          <Button variant="ghost" size="sm" className="h-8 rounded-[10px] px-3" onClick={clearCardSelection}>
            Clear selection
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-[10px] px-3"
            onClick={openBulkTagEditor}
            disabled={!canBulkEditTags || isBulkSaving}
            title={canBulkEditTags ? 'Bulk edit tags for the selected cards' : 'Select at least one card that supports tags'}
          >
            Edit tags
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="h-8 rounded-[10px] px-3"
            onClick={openBulkDeleteDialog}
            disabled={!canBulkDelete || isBulkSaving}
            title={canBulkDelete ? 'Delete the selected daily notes, topic notes, or habits' : 'Delete is only available for daily notes, topic notes, and habits'}
          >
            Delete selected
          </Button>
          {!canBulkDelete ? (
            <span className="text-[11px] text-[var(--color-text-disabled)]">
              Deletion is limited to daily notes, topic notes, and habits.
            </span>
          ) : null}
        </div>
      ) : null}

      <div
        ref={listRowRef}
        className={`flex min-h-0 w-full min-w-0 gap-1.5 ${(activeObject || isCreating) && !isSmallScreen ? 'flex-row' : 'flex-col'}`}
      >
        <div
          className="flex min-h-0 min-w-0 flex-col"
          style={(activeObject || isCreating) && !isSmallScreen ? { width: fileListWidth, minWidth: LIBRARY_LIST_MIN_WIDTH, flex: '0 0 auto' } : undefined}
        >
          <div className="ui-shell-panel relative flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--color-surface-app)]">
            {(activeObject || isCreating) && !isSmallScreen ? (
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

            <div ref={listScrollerRef} className="ui-scroller flex-1 overflow-auto px-3 py-2">
              {loading && !hasLoadedOnce ? (
                <div className="flex h-full min-h-[240px] items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-[var(--color-text-secondary)]" />
                </div>
              ) : renderedCards.length === 0 ? (
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
                  {renderedCards.map((entry) => renderBoardCard(entry, { gallery: true }))}
                </div>
              ) : (
                <div className="mx-auto flex w-full max-w-[960px] flex-col" style={{ gap: '14px' }}>
                  {renderedCards.map((entry) => renderBoardCard(entry))}
                </div>
              )}
            </div>
          </div>

          <div className="px-3 pb-1 pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 pb-[3px] text-xs text-[var(--color-text-secondary)]">
                <span>{resultsLabel}</span>
                {isRefreshing ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-control)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)]">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Updating…
                  </span>
                ) : null}
              </div>
              {showInbox && (
                <div className="inline-flex items-center gap-2 rounded-[12px] border border-[rgba(242,203,99,0.16)] bg-[var(--color-selected-fill-soft)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)]">
                  <Inbox className="h-3.5 w-3.5 text-[var(--color-accent-metadata)]" />
                  Inbox only — imported items tagged Inbox
                </div>
              )}
            </div>
          </div>
        </div>

        {(activeObject || isCreating) && (
          <section className="flex min-h-0 min-w-[420px] flex-1 flex-col overflow-hidden rounded-[18px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)]">
            <>
              {/* Panel header */}
              {!isCreating && activeObject ? (
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
              ) : null}
              <div className="flex min-h-0 flex-1 overflow-hidden p-0">
                {isCreating ? (
                  <CreatePanel
                    createType={createType}
                    initialDate={createInitialDate}
                    createKey={createKey}
                    onSave={handleSaveNew}
                    onClose={handleCloseEditor}
                    onDirty={setCreateHasUnsavedChanges}
                    onNavigateToObject={handleNavigateToObject}
                    onCreateDateChange={handleCreateDateChange}
                    showHeader
                  />
                ) : activeObject ? (
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
                        onSaveAndOpenPrevious={previousEditorNavigationTarget ? handleSaveAndOpenPrevious : undefined}
                        onSaveAndOpenNext={nextEditorNavigationTarget ? handleSaveAndOpenNext : undefined}
                        onCancel={handleCloseEditor}
                        onDirty={(isDirty) => {
                          setActiveObject((prev) => (prev ? { ...prev, isDirty } : prev))
                        }}
                        onNavigateToObject={handleNavigateToObject}
                        initialBlockId={pendingBlockId}
                      />
                    )}
                  </EditorErrorBoundary>
                ) : null}
              </div>
            </>
          </section>
        )}
      </div>


      <Dialog open={showBulkTagDialog} onOpenChange={(open) => {
        setShowBulkTagDialog(open)
        if (!open) {
          setBulkTagError(null)
          setBulkActionError(null)
        }
      }}>
        <DialogContent className="max-w-lg" aria-label="Bulk edit tags">
          <DialogHeader>
            <DialogTitle>Edit tags for selected cards</DialogTitle>
            <DialogDescription>
              Tags entered here will replace the tags on the selected items.
              {selectedEditableCards.some((card) => card.type === 'habit') ? ' Habits can only keep one tag.' : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="text-xs text-[var(--color-text-secondary)]">
              {selectedEditableCards.length} selected item{selectedEditableCards.length === 1 ? '' : 's'} support tags.
            </div>
            <Textarea
              value={bulkTagInput}
              onChange={(e) => setBulkTagInput(e.target.value)}
              placeholder="tag-one, tag-two"
              className="min-h-[120px] rounded-[12px] border-[var(--color-border-subtle)] bg-[var(--color-surface-control)] text-sm"
            />
            <div className="text-xs text-[var(--color-text-disabled)]">
              Separate tags with commas or new lines. Leaving this empty clears tags.
            </div>
            {bulkTagError ? (
              <div className="rounded-[12px] border border-[rgba(220,38,38,0.25)] bg-[rgba(220,38,38,0.08)] px-3 py-2 text-sm text-[var(--color-state-error)]">
                {bulkTagError}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowBulkTagDialog(false)} disabled={isBulkSaving}>
              Cancel
            </Button>
            <Button variant="default" onClick={() => { void handleApplyBulkTags() }} disabled={isBulkSaving}>
              {isBulkSaving ? 'Saving…' : 'Apply tags'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showBulkDeleteDialog} onOpenChange={(open) => {
        setShowBulkDeleteDialog(open)
        if (!open) {
          setBulkActionError(null)
        }
      }}>
        <DialogContent className="max-w-lg" aria-label="Delete selected cards">
          <DialogHeader>
            <DialogTitle>Delete selected cards?</DialogTitle>
            <DialogDescription>
              This permanently deletes the selected daily notes, topic notes, or habits.
              Cards that are not deletable will be ignored.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="text-sm text-[var(--color-text-secondary)]">
              {selectedDeletableCards.length} of {selectedCardCount} selected item{selectedCardCount === 1 ? '' : 's'} can be deleted.
            </div>
            {bulkActionError ? (
              <div className="rounded-[12px] border border-[rgba(220,38,38,0.25)] bg-[rgba(220,38,38,0.08)] px-3 py-2 text-sm text-[var(--color-state-error)]">
                {bulkActionError}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowBulkDeleteDialog(false)} disabled={isBulkSaving}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => { void handleConfirmBulkDelete() }} disabled={isBulkSaving}>
              {isBulkSaving ? 'Deleting…' : 'Delete selected'}
            </Button>
          </DialogFooter>
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
