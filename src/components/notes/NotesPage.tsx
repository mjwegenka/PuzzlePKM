import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Box,
  Stack,
  Paper,
  Typography,
  CircularProgress,
  Divider,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import NoteAddIcon from '@mui/icons-material/NoteAdd'
import CalendarTodayIcon from '@mui/icons-material/CalendarToday'
import RepeatIcon from '@mui/icons-material/Repeat'
import SearchIcon from '@mui/icons-material/Search'
import CloseIcon from '@mui/icons-material/Close'
import MoveToInboxIcon from '@mui/icons-material/MoveToInbox'
import TuneIcon from '@mui/icons-material/Tune'
import LabelIcon from '@mui/icons-material/Label'
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline'
import SwapVertIcon from '@mui/icons-material/SwapVert'
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
  DropdownMenuSeparator,
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
import { formatDatePretty, formatWeekdayShort, getTodayDate } from '@/lib/dateUtils'
import { getObjectColor } from '@/lib/objectColors'
import { cardSpacingTokens } from '@/theme'

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
  pendingSelection?: { id: string; type: NoteType; nonce: number; forceNewTab?: boolean } | null
  onOpenObjectTab?: (target: { id: string; type: EditorObjectType; forceNewTab?: boolean }) => void | Promise<void>
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

interface OpenEditorTab {
  tabId: string
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
      ? { date: getTodayDate(), contentMarkdown: '', tags: [], linkedObjectIds: [] }
      : createType === 'topic-note'
        ? { title: '', date: '', contentMarkdown: '', tags: [], linkedObjectIds: [] }
        : { date: getTodayDate(), text: '', tags: [] }
  ), [createType])

  return (
    <Paper
      sx={{
        flex: 1,
        minWidth: 0,
        bgcolor: 'surface.elevated',
        border: '1px solid',
        borderColor: 'border.subtle',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Panel header */}
      {showHeader ? (
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ px: 2, pt: 1.5, pb: 1, flexShrink: 0 }}
        >
          <Typography
            variant="caption"
            sx={{
              fontWeight: 700,
              color: 'text.secondary',
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              fontSize: '10px',
            }}
          >
            New Note
          </Typography>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-6 w-6 text-slate-400 hover:text-slate-100">
            <CloseIcon sx={{ fontSize: 16 }} />
          </Button>
        </Stack>
      ) : null}

      {/* Type selector */}
      <Box sx={{ px: 2, pt: showHeader ? 0 : 2, pb: 1.5, flexShrink: 0 }}>
        <Tabs value={createType} onValueChange={(value) => onTypeChange(value as NoteType)}>
          <TabsList className="grid h-9 w-full grid-cols-3 bg-slate-950 p-1 text-slate-400">
            <TabsTrigger value="topic-note" className="gap-1.5 px-2 text-[11px] data-[state=active]:bg-slate-900 data-[state=active]:text-slate-100">
              <NoteAddIcon sx={{ fontSize: 14 }} />
              Topic
            </TabsTrigger>
            <TabsTrigger value="daily-note" className="gap-1.5 px-2 text-[11px] data-[state=active]:bg-slate-900 data-[state=active]:text-slate-100">
              <CalendarTodayIcon sx={{ fontSize: 14 }} />
              Daily
            </TabsTrigger>
            <TabsTrigger value="habit" className="gap-1.5 px-2 text-[11px] data-[state=active]:bg-slate-900 data-[state=active]:text-slate-100">
              <RepeatIcon sx={{ fontSize: 14 }} />
              Habit
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </Box>

      <Divider sx={{ borderColor: 'border.subtle', flexShrink: 0 }} />

      {/* Blank editor fills remaining space */}
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', p: 0 }}>
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
      </Box>
    </Paper>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NotesPage({ onSaved, pendingSelection, onOpenObjectTab }: NotesPageProps) {
  const theme = useTheme()
  const isSmallScreen = useMediaQuery(theme.breakpoints.down('md'))
  const [topicNotes, setTopicNotes] = useState<TopicItem[]>([])
  const [dailyNotes, setDailyNotes] = useState<DailyItem[]>([])
  const [habits, setHabits] = useState<HabitItem[]>([])
  const [files, setFiles] = useState<FileItem[]>([])
  const [scriptures, setScriptures] = useState<ScriptureItem[]>([])
  const [loading, setLoading] = useState(false)

  const [openTabs, setOpenTabs] = useState<OpenEditorTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)

  // Create mode
  const [isCreating, setIsCreating] = useState(false)
  const [createType, setCreateType] = useState<NoteType>('topic-note')
  const [createKey, setCreateKey] = useState(0)
  const [createHasUnsavedChanges, setCreateHasUnsavedChanges] = useState(false)
  const [confirmCloseTabId, setConfirmCloseTabId] = useState<string | null>(null)

  // Inbox filter
  const [showInbox, setShowInbox] = useState(false)

  // Board filter
  const [boardFilter, setBoardFilter] = useState('')
  const [boardSort, setBoardSort] = useState<BoardSort>('recent')
  const [visibleObjectTypes, setVisibleObjectTypes] = useState<LibraryObjectFilterType[]>(DEFAULT_VISIBLE_LIBRARY_TYPES)
  const [selectedTagFilters, setSelectedTagFilters] = useState<string[]>([])

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

  const availableTagOptions = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>()
    const registerTags = (tags: string[]) => {
      for (const rawTag of tags ?? []) {
        const label = String(rawTag ?? '').trim()
        if (!label) continue
        const key = label.toLowerCase()
        const existing = counts.get(key)
        if (existing) {
          existing.count += 1
          continue
        }
        counts.set(key, { label, count: 1 })
      }
    }

    for (const item of topicNotes) registerTags(item.tags)
    for (const item of dailyNotes) registerTags(item.tags)
    for (const item of habits) registerTags(item.tags)
    for (const item of files) registerTags(item.tags)

    return [...counts.entries()]
      .map(([value, meta]) => ({ value, label: meta.label, count: meta.count }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
  }, [topicNotes, dailyNotes, habits, files])
  const selectedTagFilterSet = useMemo(() => new Set(selectedTagFilters), [selectedTagFilters])
  const isTagFilterCustomized = selectedTagFilters.length > 0
  const toggleTagFilter = useCallback((tagValue: string) => {
    setSelectedTagFilters((prev) => (
      prev.includes(tagValue)
        ? prev.filter((value) => value !== tagValue)
        : [...prev, tagValue]
    ))
  }, [])

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

  const closeTab = useCallback((tabId: string) => {
    setOpenTabs((prev) => {
      const index = prev.findIndex((tab) => tab.tabId === tabId)
      if (index === -1) return prev
      const next = prev.filter((tab) => tab.tabId !== tabId)
      setActiveTabId((current) => {
        if (current !== tabId) return current
        const fallback = next[index] ?? next[index - 1] ?? null
        return fallback?.tabId ?? null
      })
      return next
    })
  }, [])

  const openObjectInTab = useCallback(async (
    objectId: string,
    type: EditorObjectType,
    options?: { forceNewTab?: boolean },
  ): Promise<boolean> => {
    const forceNewTab = Boolean(options?.forceNewTab)

    if (!forceNewTab) {
      const existing = openTabs.find((tab) => tab.objectId === objectId && tab.type === type)
      if (existing) {
        setIsCreating(false)
        setActiveTabId(existing.tabId)
        return true
      }
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
    const tabId = `${type}:${objectId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`
    setIsCreating(false)
    setOpenTabs((prev) => [
      ...prev,
      { tabId, objectId, type, object: loadedObject as Record<string, unknown>, isDirty: false },
    ])
    setActiveTabId(tabId)
    return true
  }, [openTabs])

  const handleSelectItem = useCallback(async (id: string, type: EditorObjectType, options?: { forceNewTab?: boolean }) => {
    if (onOpenObjectTab) {
      await Promise.resolve(onOpenObjectTab({ id, type, forceNewTab: options?.forceNewTab }))
      return
    }
    await openObjectInTab(id, type, options)
  }, [onOpenObjectTab, openObjectInTab])

  useEffect(() => {
    if (!pendingSelection) return
    void handleSelectItem(pendingSelection.id, pendingSelection.type, { forceNewTab: Boolean(pendingSelection.forceNewTab) })
  }, [handleSelectItem, pendingSelection])

  const handleNavigateToObject = useCallback(async (target: ResolvedObjectRef, options?: { forceNewTab?: boolean }) => {
    const opened = await openObjectInTab(target.id, target.type, options)
    if (opened) return

    if (target.type === 'habit') {
      const habitsMeta = await listHabitMeta()
      const targetPath = normalizePathForLookup(target.syncPath ?? target.syncPath)
      const fallback = habitsMeta.find((item) => item.id === target.id)
        ?? habitsMeta.find((item) => normalizePathForLookup(item.syncPath ?? item.syncPath) === targetPath)
      if (fallback) {
        void openObjectInTab(fallback.id, 'habit', options)
      }
    }
  }, [openObjectInTab])

  const handleStartCreate = useCallback((type: NoteType) => {
    setActiveTabId(null)
    setCreateType(type)
    setIsCreating(true)
    setCreateHasUnsavedChanges(false)
    setCreateKey((k) => k + 1)
  }, [])

  const handleCreateDateChange = useCallback(async (date: string) => {
    if (!isCreating || createType !== 'daily-note') return
    const existing = dailyNotes.find((note) => note.date === date)
    if (!existing) return

    await openObjectInTab(existing.id, 'daily-note')
    setCreateHasUnsavedChanges(false)
  }, [createType, dailyNotes, isCreating, openObjectInTab])

  const handleSaveNew = (saved: Record<string, unknown>) => {
    const type = (saved.type as EditorObjectType | undefined) ?? createType
    const id = saved.id as string | undefined
    setCreateHasUnsavedChanges(false)
    setIsCreating(false)
    loadAll()
    if (id) {
      void openObjectInTab(id, type)
    }
    onSaved?.()
  }

  const handleSaveEdit = (saved: Record<string, unknown>) => {
    const id = saved.id as string | undefined
    const type = saved.type as EditorObjectType | undefined
    if (id && type && activeTabId) {
      setOpenTabs((prev) => prev.map((tab) =>
        tab.tabId === activeTabId
          ? { ...tab, objectId: id, type, object: { ...saved, type }, isDirty: false }
          : tab,
      ))
    }
    loadAll()
  }

  const handleRequestCloseTab = useCallback((tabId: string) => {
    const tab = openTabs.find((entry) => entry.tabId === tabId)
    if (!tab) return
    if (tab.isDirty) {
      setConfirmCloseTabId(tabId)
      return
    }
    closeTab(tabId)
  }, [closeTab, openTabs])

  const handleCloseEditor = () => {
    if (isCreating) {
      if (createHasUnsavedChanges) {
        setConfirmCloseTabId('create')
        return
      }
      setIsCreating(false)
      setCreateHasUnsavedChanges(false)
      return
    }
    if (!activeTabId) return
    handleRequestCloseTab(activeTabId)
  }

  const handleConfirmClose = () => {
    if (confirmCloseTabId === 'create') {
      setIsCreating(false)
      setCreateHasUnsavedChanges(false)
      setConfirmCloseTabId(null)
      return
    }
    if (confirmCloseTabId) {
      closeTab(confirmCloseTabId)
    }
    setConfirmCloseTabId(null)
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
          weekdayLabel: n.date ? formatWeekdayShort(n.date) : undefined,
          metadata: n.date ? formatDatePretty(n.date) : undefined,
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
        weekdayLabel: formatWeekdayShort(n.date),
        snippet: sanitizeCardPreview(n.preview) || undefined,
        tags: n.tags,
        sortTimestamp: toSortTimestamp(n.date),
      }))

    const habitCards: BoardCard[] = habits
      .filter((n) => !showInbox || hasInboxTag(n.tags))
      .map((n) => ({
        id: n.id,
        type: 'habit' as NoteType,
        title: sanitizeCardText(n.text) || '(no text)',
        weekdayLabel: n.date ? formatWeekdayShort(n.date) : undefined,
        metadata: n.date ? formatDatePretty(n.date) : undefined,
        tags: n.tags,
        sortTimestamp: toSortTimestamp(n.date),
      }))

    const fileCards: BoardCard[] = files
      .filter((f) => !showInbox || hasInboxTag(f.tags))
      .map((f) => ({
        id: f.id,
        type: f.type,
        title: f.name || (f.type === 'project' ? 'Project' : 'Reference Material'),
        metadata: f.type === 'project'
          ? (f.startDate ? formatDatePretty(f.startDate) : 'Project')
          : (f.author ? `by ${f.author}` : 'Reference'),
        snippet: f.syncPath || undefined,
        tags: f.tags,
        sortTimestamp: toSortTimestamp(f.startDate),
      }))

    const scriptureCards: BoardCard[] = scriptures
      .map((s) => ({
        id: s.id,
        type: 'scripture' as const,
        title: s.reference || 'Scripture',
        metadata: s.noteCount === 1 ? '1 linked note' : `${s.noteCount} linked notes`,
        snippet: s.passageUrl || undefined,
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

      if (selectedTagFilterSet.size > 0) {
        return (card.tags ?? []).some((tag) => selectedTagFilterSet.has(String(tag ?? '').trim().toLowerCase()))
      }

      return true
    })

    const compareByTitle = (a: BoardCard, b: BoardCard) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
    if (boardSort === 'title-asc') return cards.sort(compareByTitle)
    if (boardSort === 'title-desc') return cards.sort((a, b) => compareByTitle(b, a))
    if (boardSort === 'oldest') return cards.sort((a, b) => a.sortTimestamp - b.sortTimestamp || compareByTitle(a, b))
    return cards.sort((a, b) => b.sortTimestamp - a.sortTimestamp || compareByTitle(a, b))
  }, [topicNotes, dailyNotes, habits, files, scriptures, showInbox, boardFilter, boardSort, selectedTagFilterSet, effectiveVisibleObjectTypeSet])
  const activeTab = openTabs.find((tab) => tab.tabId === activeTabId) ?? null
  const activeNoteType = activeTab?.type === 'topic-note' || activeTab?.type === 'daily-note' || activeTab?.type === 'habit' || activeTab?.type === 'project' || activeTab?.type === 'ref-material' || activeTab?.type === 'scripture' || activeTab?.type === 'tag'
    ? activeTab.type
    : null
  const activeNoteId = activeNoteType ? activeTab?.objectId ?? null : null

  const getTabLabel = (tab: OpenEditorTab) => {
    if (tab.type === 'daily-note') {
      const value = tab.object.date as string | undefined
      return value ? formatDatePretty(value) : 'Daily Note'
    }
    if (tab.type === 'habit') {
      return (tab.object.text as string | undefined)?.trim() || 'Habit'
    }
    if (tab.type === 'project') {
      return (tab.object.name as string | undefined)?.trim() || 'Project'
    }
    if (tab.type === 'ref-material') {
      return (tab.object.name as string | undefined)?.trim() || 'Reference Material'
    }
    if (tab.type === 'scripture') {
      return (tab.object.reference as string | undefined)?.trim() || 'Scripture'
    }
    if (tab.type === 'tag') {
      const display = (tab.object.displayName as string | undefined)?.trim() || (tab.object.name as string | undefined)?.trim()
      return display ? `#${display}` : 'Tag'
    }
    return (tab.object.title as string | undefined)?.trim() || 'Topic Note'
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden', width: '100%', minWidth: 0 }}>
      {/* ── Compact Toolbar ──────────────────────────────────────────────────── */}
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{
          mb: 1,
          flexShrink: 0,
          minHeight: cardSpacingTokens.toolbarRowMinHeight,
          px: 1,
          py: 0.75,
          borderRadius: '10px',
          bgcolor: 'transparent',
          border: '1px solid',
          borderColor: 'border.subtle',
        }}
      >
        {/* Filter chip row */}
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ flex: 1, minWidth: 0, overflowX: 'auto', overflowY: 'hidden', py: 0.25 }}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <FilterChip
                icon={<TuneIcon />}
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <FilterChip
                icon={<LabelIcon />}
                label="Tags"
                showCaret
                selected={isTagFilterCustomized}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              {availableTagOptions.length === 0 ? (
                <DropdownMenuItem disabled>No tags yet</DropdownMenuItem>
              ) : (
                availableTagOptions.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.value}
                    checked={selectedTagFilterSet.has(option.value)}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={() => toggleTagFilter(option.value)}
                  >
                    <span className="flex flex-1 items-center justify-between gap-3">
                      <span>#{option.label}</span>
                      <span className="text-xs text-slate-400">{option.count} {option.count === 1 ? 'object' : 'objects'}</span>
                    </span>
                  </DropdownMenuCheckboxItem>
                ))
              )}
              {availableTagOptions.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={selectedTagFilters.length === 0}
                    onSelect={() => setSelectedTagFilters([])}
                  >
                    Clear selection
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </Stack>

        <Stack direction="row" alignItems="center" spacing={1} sx={{ flexShrink: 0 }}>
          {/* Search input */}
          <div className="relative w-[220px] shrink-0">
            <SearchIcon
              sx={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: 14,
                color: 'text.disabled',
                pointerEvents: 'none',
              }}
            />
            <Input
              placeholder="Find a note..."
              value={boardFilter}
              onChange={(e) => setBoardFilter(e.target.value)}
              className="h-8 border-slate-800 bg-slate-950 pl-8 text-xs text-slate-200 placeholder:text-slate-500"
            />
          </div>

          <Select value={boardSort} onValueChange={(value) => setBoardSort(value as BoardSort)}>
            <SelectTrigger aria-label="Sort notes" className="h-8 w-[146px] border-slate-800 bg-slate-950 text-xs text-slate-200">
              <span className="flex items-center gap-1">
                <SwapVertIcon sx={{ fontSize: 14 }} />
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

          {/* +New button */}
          <TooltipProvider>
            <Tooltip>
              <DropdownMenu>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label="Create a new object"
                      className="h-8 shrink-0 border-slate-800 bg-slate-950 px-2 text-xs text-slate-100 hover:bg-slate-900"
                    >
                      <AddCircleOutlineIcon sx={{ fontSize: 16 }} />
                      <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                        +New
                      </Box>
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuItem onSelect={() => handleStartCreate('topic-note')}>
                    <span className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-2">
                        <NoteAddIcon fontSize="small" />
                        Topic Note
                      </span>
                      <span className="pl-6 text-xs text-slate-400">Create a titled note</span>
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleStartCreate('daily-note')}>
                    <span className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-2">
                        <CalendarTodayIcon fontSize="small" />
                        Daily Note
                      </span>
                      <span className="pl-6 text-xs text-slate-400">Create or open a dated daily note</span>
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleStartCreate('habit')}>
                    <span className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-2">
                        <RepeatIcon fontSize="small" />
                        Habit
                      </span>
                      <span className="pl-6 text-xs text-slate-400">Create a dated habit entry</span>
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <TooltipContent>Create a new object</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Inbox toggle */}
          <Button
            size="icon"
            variant={showInbox ? 'secondary' : 'ghost'}
            onClick={() => setShowInbox((v) => !v)}
            title={showInbox ? 'Show all notes' : 'Show Inbox only'}
            className="h-8 w-8 shrink-0"
          >
            <MoveToInboxIcon sx={{ fontSize: 18 }} />
          </Button>
        </Stack>
      </Stack>

      <Stack direction={activeTab ? 'row' : 'column'} spacing={1.5} sx={{ flex: 1, minHeight: 0, width: '100%', minWidth: 0 }}>
       <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', width: '100%', minWidth: 0 }}>
         {/* ── Inbox banner ─────────────────────────────────── */}
         {showInbox && (
           <Stack
             direction="row"
             alignItems="center"
             spacing={0.75}
             sx={{ mb: 1, px: 1, py: 0.5, bgcolor: 'surface.sunken', borderRadius: '6px', border: '1px solid', borderColor: 'border.subtle' }}
           >
             <MoveToInboxIcon sx={{ fontSize: 14, color: 'accent.metadata' }} />
             <Typography variant="caption" sx={{ color: 'accent.metadata', fontWeight: 600, fontSize: '11px' }}>
               Inbox — showing only newly imported objects tagged Inbox
             </Typography>
           </Stack>
         )}

         {/* ── Unified masonry card board ────────────────────── */}
         {loading ? (
           <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
             <CircularProgress size={24} />
           </Box>
         ) : allCards.length === 0 ? (
           <Typography variant="caption" sx={{ color: 'text.disabled', fontStyle: 'italic', p: 1.5, display: 'block' }}>
             {boardFilter || showInbox || hasActiveBoardFilters ? 'No matches' : 'Nothing here yet'}
           </Typography>
         ) : (
           <Box
             sx={{
                columnWidth: { xs: '100%', sm: '260px' },
                columnGap: cardSpacingTokens.cardVerticalGutter,
                width: '100%',
                minWidth: 0,
             }}
           >
             {allCards.map((card) => (
                <Box
                  key={`${card.type}:${card.id}`}
                  sx={{
                    mb: cardSpacingTokens.cardVerticalGutter,
                    breakInside: 'avoid',
                    WebkitColumnBreakInside: 'avoid',
                  }}
                >
                  {(() => {
                    const isOpenable = card.type === 'topic-note' || card.type === 'daily-note' || card.type === 'habit' || card.type === 'project' || card.type === 'ref-material' || card.type === 'scripture' || card.type === 'tag'
                    return (
                  <NoteCard
                    card={card}
                    isSelected={activeNoteId === card.id && activeNoteType === card.type}
                    onClick={isOpenable ? (e) => handleSelectItem(card.id, card.type as EditorObjectType, { forceNewTab: e.metaKey || e.ctrlKey }) : undefined}
                    title={isOpenable ? 'Click to open • Ctrl/Cmd-click to open in new tab' : undefined}
                  />
                    )
                  })()}
                </Box>
             ))}
           </Box>
         )}
       </Box>

      {activeTab && (
        <Paper
          sx={{
            width: 560,
            minWidth: 420,
            bgcolor: 'surface.elevated',
            border: '1px solid',
            borderColor: 'border.subtle',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
         }}
        >
         <>
           <Stack
             direction="row"
             alignItems="center"
             gap={0.5}
             sx={{ px: 1, py: 0.5, borderBottom: '1px solid', borderColor: 'border.subtle', bgcolor: 'surface.elevated' }}
           >
             <Tabs value={activeTab?.tabId ?? ''} onValueChange={setActiveTabId}>
               <Box sx={{ maxWidth: 480, overflowX: 'auto' }}>
                 <TabsList aria-label="Object editor tabs" className="h-auto min-h-10 w-max justify-start gap-2 bg-transparent p-0">
                   {openTabs.map((tab) => {
                     const tabToken = getObjectColor(tab.type)
                     return (
                       <div key={tab.tabId} className="relative shrink-0">
                         <TabsTrigger
                           value={tab.tabId}
                           className="h-10 min-w-0 rounded-t-md border border-transparent bg-transparent px-3 pr-8 text-slate-400 shadow-none data-[state=active]:bg-slate-950/70 data-[state=active]:text-slate-100 data-[state=active]:shadow-none"
                           style={{
                             boxShadow: activeTabId === tab.tabId ? `inset 0 2px 0 ${tabToken.accent}` : undefined,
                             color: activeTabId === tab.tabId ? tabToken.text : undefined,
                           }}
                         >
                           <span className="flex min-h-6 items-center gap-2">
                             <Box
                               className="notes-editor-tab-dot"
                               sx={{
                                 width: 5,
                                 height: 5,
                                 borderRadius: '50%',
                                 bgcolor: activeTabId === tab.tabId ? tabToken.accent : tabToken.text,
                                 flexShrink: 0,
                               }}
                             />
                             <Typography variant="caption" sx={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.1, fontWeight: 500 }}>
                               {getTabLabel(tab)}
                             </Typography>
                             {tab.isDirty ? <Box sx={{ width: 5, height: 5, borderRadius: '999px', bgcolor: 'accent.metadata' }} /> : null}
                           </span>
                         </TabsTrigger>
                         <Button
                           type="button"
                           variant="ghost"
                           size="icon"
                           className="absolute right-1 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 hover:text-slate-100"
                           onClick={(event) => {
                             event.stopPropagation()
                             handleRequestCloseTab(tab.tabId)
                           }}
                           aria-label={`Close ${getTabLabel(tab)} tab`}
                         >
                           <CloseIcon sx={{ fontSize: 11 }} />
                         </Button>
                       </div>
                     )
                   })}
                 </TabsList>
               </Box>
             </Tabs>
             <Button variant="ghost" size="icon" onClick={handleCloseEditor} className="h-7 w-7 text-slate-400 hover:text-slate-100">
               <CloseIcon fontSize="small" />
             </Button>
           </Stack>
           <Box sx={{ p: 0, flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
             {activeTab ? (
               <EditorErrorBoundary>
                  {activeTab.type === 'scripture' || activeTab.type === 'tag' ? (
                    <ObjectMetaDetailPanel
                      object={activeTab.object}
                      type={activeTab.type}
                      flatTop
                      onNavigateToObject={handleNavigateToObject}
                    />
                  ) : (
                    <ObjectEditor
                      key={activeTab.tabId}
                      object={activeTab.object}
                      type={activeTab.type}
                       flatTop
                      onSave={handleSaveEdit}
                      onCancel={handleCloseEditor}
                      onDirty={(isDirty) => {
                        if (!activeTabId) return
                        setOpenTabs((prev) => prev.map((tab) => (
                          tab.tabId === activeTabId ? { ...tab, isDirty } : tab
                        )))
                      }}
                      onNavigateToObject={handleNavigateToObject}
                    />
                  )}
               </EditorErrorBoundary>
             ) : null}
           </Box>
         </>
       </Paper>
      )}
      </Stack>

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
      <Dialog open={!!confirmCloseTabId} onOpenChange={(open) => { if (!open) setConfirmCloseTabId(null) }}>
        {confirmCloseTabId ? (
          <DialogContent className="max-w-sm" aria-label="Unsaved Changes">
            <DialogHeader>
              <DialogTitle>Unsaved Changes</DialogTitle>
              <DialogDescription>
                You have unsaved changes. Are you sure you want to close without saving?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmCloseTabId(null)}>Cancel</Button>
              <Button onClick={handleConfirmClose} variant="destructive">
                Discard Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
     </Box>
   )
}
