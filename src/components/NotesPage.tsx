import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Box,
  Stack,
  Paper,
  Typography,
  Button,
  TextField,
  CircularProgress,
  Divider,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tabs,
  Tab,
  IconButton as MuiIconButton,
  Menu,
  MenuItem,
  Tooltip,
  ListItemIcon,
  ListItemText,
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
import ObjectEditor from './ObjectEditor'
import EditorErrorBoundary from './EditorErrorBoundary'
import FilterChip from './ui/FilterChip'
import { NoteCard } from './ui/NoteCard'
import type { NoteCardData } from './ui/NoteCard'
import { listTopicNoteMeta, listDailyNoteMeta, listHabitMeta, listFileMeta, getObject } from '../lib/cliService'
import type { ResolvedObjectRef } from '../lib/cliService'
import { formatDatePretty, formatWeekdayShort, getTodayDate } from '../lib/dateUtils'
import { getObjectColor } from '../lib/objectColors'
import { cardSpacingTokens } from '../theme'

function normalizePathForLookup(path?: string): string {
  return String(path ?? '')
    .trim()
    .replace(/[?#].*$/, '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .toLowerCase()
}

type NoteType = 'topic-note' | 'daily-note' | 'habit'
type EditorObjectType = NoteType | 'project' | 'ref-material'

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
  type: EditorObjectType
  sortTimestamp: number
}

type BoardSort = 'recent' | 'oldest' | 'title-asc' | 'title-desc'
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
          <IconButton size="small" onClick={onClose} sx={{ color: 'text.secondary', p: 0.25 }}>
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Stack>
      ) : null}

      {/* Type selector */}
      <Box sx={{ px: 2, pt: showHeader ? 0 : 2, pb: 1.5, flexShrink: 0 }}>
        <ToggleButtonGroup
          value={createType}
          exclusive
          onChange={(_, v: NoteType | null) => { if (v) onTypeChange(v) }}
          size="small"
          fullWidth
          sx={{
            '& .MuiToggleButton-root': {
              color: 'text.secondary',
              borderColor: 'border.subtle',
              py: 0.5,
              fontSize: '11px',
              flex: 1,
              '&.Mui-selected': {
                bgcolor: 'action.selected',
                color: 'text.primary',
                borderColor: 'border.strong',
              },
            },
            '& .MuiToggleButtonGroup-grouped:not(:last-of-type)': {
              borderRight: '1px solid',
              borderColor: 'border.subtle',
            },
            '& .MuiToggleButtonGroup-grouped.Mui-selected:not(:last-of-type)': {
              borderRight: '1px solid',
              borderColor: 'border.strong',
            },
          }}
        >
          <ToggleButton value="topic-note">
            <NoteAddIcon sx={{ fontSize: 14, mr: 0.5 }} />
            Topic
          </ToggleButton>
          <ToggleButton value="daily-note">
            <CalendarTodayIcon sx={{ fontSize: 14, mr: 0.5 }} />
            Daily
          </ToggleButton>
          <ToggleButton value="habit">
            <RepeatIcon sx={{ fontSize: 14, mr: 0.5 }} />
            Habit
          </ToggleButton>
        </ToggleButtonGroup>
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
  const [loading, setLoading] = useState(false)

  const [openTabs, setOpenTabs] = useState<OpenEditorTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)

  // Create mode
  const [isCreating, setIsCreating] = useState(false)
  const [createType, setCreateType] = useState<NoteType>('topic-note')
  const [createKey, setCreateKey] = useState(0)
  const [createHasUnsavedChanges, setCreateHasUnsavedChanges] = useState(false)
  const [createMenuAnchorEl, setCreateMenuAnchorEl] = useState<HTMLElement | null>(null)
  const [confirmCloseTabId, setConfirmCloseTabId] = useState<string | null>(null)

  // Inbox filter
  const [showInbox, setShowInbox] = useState(false)

  // Board filter
  const [boardFilter, setBoardFilter] = useState('')
  const [boardSort, setBoardSort] = useState<BoardSort>('recent')
  const [activeFilterChips, setActiveFilterChips] = useState<{ cardType: boolean; tags: boolean; untagged: boolean; custom: boolean }>({
    cardType: false,
    tags: false,
    untagged: false,
    custom: false,
  })
  const [showCustomFilterChip, setShowCustomFilterChip] = useState(true)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [topicsRes, dailiesRes, habitsRes, filesRes] = await Promise.allSettled([
        listTopicNoteMeta(),
        listDailyNoteMeta(),
        listHabitMeta(),
        listFileMeta(),
      ])
      if (topicsRes.status === 'fulfilled')
        setTopicNotes(topicsRes.value as TopicItem[])
      if (dailiesRes.status === 'fulfilled')
        setDailyNotes(dailiesRes.value as DailyItem[])
      if (habitsRes.status === 'fulfilled')
        setHabits(habitsRes.value as HabitItem[])
      if (filesRes.status === 'fulfilled')
        setFiles(filesRes.value as FileItem[])
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
      const targetPath = normalizePathForLookup(target.syncPath ?? target.dropboxPath)
      const fallback = habitsMeta.find((item) => item.id === target.id)
        ?? habitsMeta.find((item) => normalizePathForLookup(item.syncPath ?? item.dropboxPath) === targetPath)
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
    setCreateMenuAnchorEl(null)
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
  const hasInboxTag = (tags: string[]) => tags.some((t) => t.toLowerCase() === 'inbox')
  const hasActiveBoardFilters = activeFilterChips.cardType || activeFilterChips.tags || activeFilterChips.untagged || activeFilterChips.custom
  const allCards = useMemo((): BoardCard[] => {
    const normalizedBoardFilter = normalizeSearchQuery(boardFilter)
    const topicCards: BoardCard[] = topicNotes
      .filter((n) => !showInbox || hasInboxTag(n.tags))
      .map((n) => ({
        id: n.id,
        type: 'topic-note' as NoteType,
        title: deriveTopicCardTitle(n.title, n.preview, n.date),
        weekdayLabel: n.date ? formatWeekdayShort(n.date) : undefined,
        metadata: n.date ? formatDatePretty(n.date) : undefined,
        snippet: sanitizeCardPreview(n.preview) || undefined,
        tags: n.tags,
        sortTimestamp: toSortTimestamp(n.updatedAt, n.date),
      }))

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

    const currentTab = openTabs.find((tab) => tab.tabId === activeTabId) ?? null
    const selectedCardType: EditorObjectType | null = isCreating
      ? createType
      : currentTab?.type === 'topic-note' || currentTab?.type === 'daily-note' || currentTab?.type === 'habit' || currentTab?.type === 'project' || currentTab?.type === 'ref-material'
        ? currentTab.type
        : null
    const cards = [...topicCards, ...dailyCards, ...habitCards, ...fileCards].filter((card) => {
      if (!cardMatchesSearch(card, normalizedBoardFilter)) return false
      if (activeFilterChips.cardType && selectedCardType && card.type !== selectedCardType) return false

      const hasTags = (card.tags?.length ?? 0) > 0
      if (activeFilterChips.tags !== activeFilterChips.untagged) {
        return activeFilterChips.tags ? hasTags : !hasTags
      }

      return true
    })

    const compareByTitle = (a: BoardCard, b: BoardCard) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
    if (boardSort === 'title-asc') return cards.sort(compareByTitle)
    if (boardSort === 'title-desc') return cards.sort((a, b) => compareByTitle(b, a))
    if (boardSort === 'oldest') return cards.sort((a, b) => a.sortTimestamp - b.sortTimestamp || compareByTitle(a, b))
    return cards.sort((a, b) => b.sortTimestamp - a.sortTimestamp || compareByTitle(a, b))
  }, [topicNotes, dailyNotes, habits, files, showInbox, boardFilter, boardSort, activeFilterChips, openTabs, activeTabId, isCreating, createType])
  const activeTab = openTabs.find((tab) => tab.tabId === activeTabId) ?? null
  const activeNoteType = activeTab?.type === 'topic-note' || activeTab?.type === 'daily-note' || activeTab?.type === 'habit' || activeTab?.type === 'project' || activeTab?.type === 'ref-material'
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
          bgcolor: 'surface.elevated',
          border: '1px solid',
          borderColor: 'border.subtle',
        }}
      >
        {/* Filter chip row */}
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ flex: 1, minWidth: 0, overflowX: 'auto', overflowY: 'hidden', py: 0.25 }}>
           <FilterChip
             icon={<TuneIcon />}
             label="Object type"
             showCaret
             selected={activeFilterChips.cardType}
             onToggle={() => setActiveFilterChips((prev) => ({ ...prev, cardType: !prev.cardType }))}
           />
           <FilterChip
             icon={<LabelIcon />}
             label="Tags"
             showCaret
             selected={activeFilterChips.tags}
             onToggle={() => setActiveFilterChips((prev) => ({ ...prev, tags: !prev.tags }))}
           />
           <FilterChip
             icon={<LabelIcon />}
             label="Untagged"
             selected={activeFilterChips.untagged}
             onToggle={() => setActiveFilterChips((prev) => ({ ...prev, untagged: !prev.untagged }))}
           />
           {showCustomFilterChip && (
             <FilterChip
               icon={<TuneIcon />}
               label="Custom"
               selected={activeFilterChips.custom}
               onToggle={() => setActiveFilterChips((prev) => ({ ...prev, custom: !prev.custom }))}
               onDismiss={() => {
                 setShowCustomFilterChip(false)
                 setActiveFilterChips((prev) => ({ ...prev, custom: false }))
               }}
             />
           )}
           <FilterChip
             icon={<AddCircleOutlineIcon />}
             label="New filter"
             showCaret
             onToggle={() => {
               setShowCustomFilterChip(true)
               setActiveFilterChips((prev) => ({ ...prev, custom: true }))
             }}
           />
         </Stack>

        <Stack direction="row" alignItems="center" spacing={1} sx={{ flexShrink: 0 }}>
          {/* Search input */}
          <TextField
            size="small"
            placeholder="Find a note..."
            value={boardFilter}
            onChange={(e) => setBoardFilter(e.target.value)}
            variant="outlined"
            sx={{
              width: 220,
              flexShrink: 0,
              '& .MuiOutlinedInput-root': {
                minHeight: 32,
                fontSize: '12px',
                bgcolor: 'surface.sunken',
                color: 'text.secondary',
                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'border.strong' },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'border.strong' },
              },
              '& .MuiOutlinedInput-notchedOutline': { borderColor: 'border.subtle' },
              '& .MuiOutlinedInput-input::placeholder': { color: 'text.disabled', opacity: 1 },
            }}
            slotProps={{
              input: {
                startAdornment: <SearchIcon sx={{ fontSize: 14, color: 'text.disabled', mr: 0.5, flexShrink: 0 }} />,
              },
            }}
          />

          <TextField
            select
            size="small"
            value={boardSort}
            onChange={(event) => setBoardSort(event.target.value as BoardSort)}
            aria-label="Sort notes"
            sx={{
              width: 146,
              flexShrink: 0,
              '& .MuiOutlinedInput-root': {
                minHeight: 30,
                fontSize: '12px',
                bgcolor: 'surface.sunken',
                color: 'text.secondary',
                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'border.strong' },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'border.strong' },
              },
              '& .MuiOutlinedInput-notchedOutline': { borderColor: 'border.subtle' },
            }}
            slotProps={{
              select: {
                renderValue: (value) => (
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    <SwapVertIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                    <Box component="span">{BOARD_SORT_LABELS[String(value) as BoardSort] ?? String(value)}</Box>
                  </Stack>
                ),
              },
            }}
          >
            <MenuItem value="recent">{BOARD_SORT_LABELS.recent}</MenuItem>
            <MenuItem value="oldest">{BOARD_SORT_LABELS.oldest}</MenuItem>
            <MenuItem value="title-asc">{BOARD_SORT_LABELS['title-asc']}</MenuItem>
            <MenuItem value="title-desc">{BOARD_SORT_LABELS['title-desc']}</MenuItem>
          </TextField>

          {/* +New button */}
          <Tooltip title="Create a new object">
            <Button
              variant="outlined"
              size="small"
              onClick={(event) => setCreateMenuAnchorEl(event.currentTarget)}
              aria-haspopup="menu"
              aria-expanded={createMenuAnchorEl ? 'true' : undefined}
              aria-controls={createMenuAnchorEl ? 'create-object-menu' : undefined}
              aria-label="Create a new object"
              startIcon={<AddCircleOutlineIcon sx={{ fontSize: 16 }} />}
              sx={{
                flexShrink: 0,
                fontSize: '12px',
                minHeight: 32,
                minWidth: { xs: 0, sm: 'auto' },
                px: { xs: 0.75, sm: 1 },
                py: 0.25,
                borderColor: 'border.subtle',
                color: 'text.primary',
                bgcolor: 'surface.sunken',
                '&:hover': { borderColor: 'border.strong', bgcolor: 'surface.elevated' },
                '& .MuiButton-startIcon': {
                  mr: { xs: 0, sm: 0.5 },
                  ml: 0,
                },
              }}
            >
              <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                +New
              </Box>
            </Button>
          </Tooltip>

          <Menu
            id="create-object-menu"
            anchorEl={createMenuAnchorEl}
            open={Boolean(createMenuAnchorEl)}
            onClose={() => setCreateMenuAnchorEl(null)}
            slotProps={{
              list: { 'aria-label': 'Create object type' },
            }}
          >
            <MenuItem onClick={() => handleStartCreate('topic-note')}>
              <ListItemIcon>
                <NoteAddIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Topic Note" secondary="Create a titled note" />
            </MenuItem>
            <MenuItem onClick={() => handleStartCreate('daily-note')}>
              <ListItemIcon>
                <CalendarTodayIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Daily Note" secondary="Create or open a dated daily note" />
            </MenuItem>
            <MenuItem onClick={() => handleStartCreate('habit')}>
              <ListItemIcon>
                <RepeatIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Habit" secondary="Create a dated habit entry" />
            </MenuItem>
          </Menu>

          {/* Inbox toggle */}
          <IconButton
            size="small"
            onClick={() => setShowInbox((v) => !v)}
            title={showInbox ? 'Show all notes' : 'Show Inbox only'}
            sx={{
              color: showInbox ? 'accent.metadata' : 'text.secondary',
              bgcolor: showInbox ? 'action.selected' : 'transparent',
              border: '1px solid',
              borderColor: showInbox ? 'border.strong' : 'transparent',
              borderRadius: '6px',
              flexShrink: 0,
              '&:hover': { bgcolor: showInbox ? 'action.focus' : 'action.hover' },
            }}
          >
            <MoveToInboxIcon sx={{ fontSize: 18 }} />
          </IconButton>
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
               display: 'grid',
               gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
               gap: cardSpacingTokens.cardVerticalGutter,
               alignItems: 'start',
                width: '100%',
                minWidth: 0,
             }}
           >
             {allCards.map((card) => (
                <NoteCard
                  key={`${card.type}:${card.id}`}
                  card={card}
                  isSelected={activeNoteId === card.id && activeNoteType === card.type}
                  onClick={(e) => handleSelectItem(card.id, card.type, { forceNewTab: e.metaKey || e.ctrlKey })}
                  title="Click to open • Ctrl/Cmd-click to open in new tab"
                />
             ))}
           </Box>
         )}
       </Box>

      {activeTab && (
        <Paper sx={{ width: 560, minWidth: 420, bgcolor: 'surface.elevated', border: '1px solid', borderColor: 'border.subtle', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
         <>
           <Stack direction="row" alignItems="center" gap={0.5} sx={{ px: 1, py: 0.25, borderBottom: '1px solid', borderColor: 'border.subtle' }}>
             <Tabs
               value={activeTab?.tabId ?? false}
               onChange={(_, value: string) => setActiveTabId(value)}
                aria-label="Object editor tabs"
               variant="scrollable"
               scrollButtons="auto"
               sx={{
                  minHeight: 40,
                 flex: 1,
                 '& .MuiTabs-indicator': { display: 'none' },
                 '& .MuiTabs-flexContainer': { alignItems: 'flex-end', gap: 0.5 },
                 '& .MuiTabs-scroller': { overflow: 'visible !important' },
                 '& .MuiTabScrollButton-root': { width: 24, color: 'text.secondary' },
                 '& .MuiTab-root': {
                    minHeight: 40,
                   textTransform: 'none',
                   minWidth: 0,
                    px: 0.75,
                    py: 0,
                    color: 'text.secondary',
                    transition: 'color 120ms ease',
                   '&:hover': {
                      color: 'text.primary',
                   },
                    '&.Mui-selected': {
                      color: 'text.primary',
                    },
                 },
               }}
             >
               {openTabs.map((tab) => {
                 const tabToken = getObjectColor(tab.type)
                 return (
                   <Tab
                     key={tab.tabId}
                     value={tab.tabId}
                     disableRipple
                     sx={{
                       '&.Mui-selected': {
                         color: tabToken.text,
                         backgroundColor: '#1a1c1f',
                         borderColor: tabToken.border,
                         borderBottomColor: '#1a1c1f',
                         boxShadow: `inset 0 2px 0 ${tabToken.accent}`,
                         bgcolor: tabToken.accent,
                       },
                       '&.Mui-selected .notes-editor-tab-dot': {
                         bgcolor: tabToken.accent,
                       },
                     }}
                     label={(
                        <Stack direction="row" alignItems="center" spacing={0.45} sx={{ minHeight: 24 }}>
                          <Box className="notes-editor-tab-dot" sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: tabToken.text, flexShrink: 0 }} />
                          <Typography variant="caption" sx={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.1, fontWeight: 500 }}>
                           {getTabLabel(tab)}
                         </Typography>
                         {tab.isDirty ? <Box sx={{ width: 5, height: 5, borderRadius: '999px', bgcolor: 'accent.metadata' }} /> : null}
                         <MuiIconButton
                           size="small"
                           onClick={(event) => {
                             event.stopPropagation()
                             handleRequestCloseTab(tab.tabId)
                           }}
                           sx={{
                             p: 0.1,
                              color: 'inherit',
                              opacity: 0.72,
                             '&:hover': { opacity: 1, bgcolor: 'action.hover' },
                           }}
                         >
                           <CloseIcon sx={{ fontSize: 11 }} />
                         </MuiIconButton>
                       </Stack>
                     )}
                   />
                 )
               })}
             </Tabs>
              <MuiIconButton size="small" onClick={handleCloseEditor}>
               <CloseIcon fontSize="small" />
             </MuiIconButton>
           </Stack>
           <Box sx={{ p: 1.5, flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
             {activeTab ? (
               <EditorErrorBoundary>
                 <ObjectEditor
                   key={activeTab.tabId}
                   object={activeTab.object}
                   type={activeTab.type}
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
               </EditorErrorBoundary>
             ) : null}
           </Box>
         </>
       </Paper>
      )}
      </Stack>

      <Dialog
       open={isCreating}
       onClose={handleCloseEditor}
       fullWidth
       maxWidth="lg"
       fullScreen={isSmallScreen}
       aria-labelledby="create-object-dialog-title"
       slotProps={{
         paper: {
           sx: {
             height: isSmallScreen ? '100%' : 'min(720px, calc(100vh - 64px))',
             maxHeight: isSmallScreen ? '100%' : 'calc(100vh - 32px)',
             bgcolor: 'surface.app',
           },
         },
       }}
      >
       <DialogTitle id="create-object-dialog-title" sx={{ pr: 6 }}>
         Create New Note
       </DialogTitle>
       <MuiIconButton
         size="small"
         aria-label="Close create note dialog"
         onClick={handleCloseEditor}
         sx={{ position: 'absolute', right: 12, top: 12, color: 'text.secondary' }}
       >
         <CloseIcon fontSize="small" />
       </MuiIconButton>
       <DialogContent sx={{ p: { xs: 1, sm: 1.5 }, display: 'flex', minHeight: 0 }}>
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
       </DialogContent>
      </Dialog>

       {/* Confirmation Dialog for unsaved changes */}
       <Dialog
          open={!!confirmCloseTabId}
          onClose={() => setConfirmCloseTabId(null)}
        >
          <DialogTitle>Unsaved Changes</DialogTitle>
          <DialogContent>
            <Typography>
              You have unsaved changes. Are you sure you want to close without saving?
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmCloseTabId(null)}>Cancel</Button>
            <Button onClick={handleConfirmClose} variant="contained" color="error">
              Discard Changes
            </Button>
         </DialogActions>
       </Dialog>
     </Box>
   )
}
