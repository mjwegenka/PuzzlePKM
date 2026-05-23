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
import ObjectEditor from './ObjectEditor'
import EditorErrorBoundary from './EditorErrorBoundary'
import FilterChip from './ui/FilterChip'
import { NoteCard } from './ui/NoteCard'
import type { NoteCardData } from './ui/NoteCard'
import { listTopicNoteMeta, listDailyNoteMeta, listHabitMeta, listFileMeta, getObject } from '../lib/cliService'
import type { ResolvedObjectRef } from '../lib/cliService'
import { formatDatePretty, formatWeekdayShort, getTodayDate } from '../lib/dateUtils'
import { getObjectColor } from '../lib/objectColors'

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
}

function CreatePanel({ createType, createKey, onTypeChange, onSave, onClose, onDirty, onNavigateToObject, onCreateDateChange }: CreatePanelProps) {
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
        bgcolor: '#0e2038',
        border: '1px solid #1c3558',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Panel header */}
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
            color: '#7dbad6',
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            fontSize: '10px',
          }}
        >
          New Note
        </Typography>
        <IconButton size="small" onClick={onClose} sx={{ color: '#7dbad6', p: 0.25 }}>
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Stack>

      {/* Type selector */}
      <Box sx={{ px: 2, pb: 1.5, flexShrink: 0 }}>
        <ToggleButtonGroup
          value={createType}
          exclusive
          onChange={(_, v: NoteType | null) => { if (v) onTypeChange(v) }}
          size="small"
          fullWidth
          sx={{
            '& .MuiToggleButton-root': {
              color: '#7dbad6',
              borderColor: '#1c3558',
              py: 0.5,
              fontSize: '11px',
              flex: 1,
              '&.Mui-selected': {
                bgcolor: 'rgba(26,138,181,0.25)',
                color: '#e4f0fb',
                borderColor: '#1a8ab5',
              },
            },
            '& .MuiToggleButtonGroup-grouped:not(:last-of-type)': {
              borderRight: '1px solid #1c3558 !important',
            },
            '& .MuiToggleButtonGroup-grouped.Mui-selected:not(:last-of-type)': {
              borderRight: '1px solid #1a8ab5 !important',
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

      <Divider sx={{ borderColor: '#1c3558', flexShrink: 0 }} />

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
  const [confirmCloseTabId, setConfirmCloseTabId] = useState<string | null>(null)

  // Inbox filter
  const [showInbox, setShowInbox] = useState(false)

  // Board filter
  const [boardFilter, setBoardFilter] = useState('')
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

  const handleNewNote = () => {
    setActiveTabId(null)
    setIsCreating(true)
    setCreateHasUnsavedChanges(false)
    setCreateKey((k) => k + 1)
  }

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
    const topicCards: BoardCard[] = topicNotes
      .filter((n) =>
        (!showInbox || hasInboxTag(n.tags)) &&
        (!boardFilter ||
          n.title.toLowerCase().includes(boardFilter.toLowerCase()) ||
          n.preview.toLowerCase().includes(boardFilter.toLowerCase())),
      )
      .map((n) => ({
        id: n.id,
        type: 'topic-note' as NoteType,
        title: deriveTopicCardTitle(n.title, n.preview, n.date),
        weekdayLabel: n.date ? formatWeekdayShort(n.date) : undefined,
        metadata: n.date ? formatDatePretty(n.date) : undefined,
        snippet: sanitizeCardText(n.preview) || undefined,
        tags: n.tags,
      }))

    const dailyCards: BoardCard[] = dailyNotes
      .filter((n) =>
        (!showInbox || hasInboxTag(n.tags)) &&
        (!boardFilter ||
          n.date.includes(boardFilter) ||
          formatDatePretty(n.date).toLowerCase().includes(boardFilter.toLowerCase()) ||
          n.preview?.toLowerCase().includes(boardFilter.toLowerCase())),
      )
      .map((n) => ({
        id: n.id,
        type: 'daily-note' as NoteType,
        title: formatDatePretty(n.date),
        weekdayLabel: formatWeekdayShort(n.date),
        snippet: sanitizeCardText(n.preview) || undefined,
        tags: n.tags,
      }))

    const habitCards: BoardCard[] = habits
      .filter((n) =>
        (!showInbox || hasInboxTag(n.tags)) &&
        (!boardFilter ||
          n.text.toLowerCase().includes(boardFilter.toLowerCase()) ||
          n.date.includes(boardFilter) ||
          formatDatePretty(n.date).toLowerCase().includes(boardFilter.toLowerCase())),
      )
      .map((n) => ({
        id: n.id,
        type: 'habit' as NoteType,
        title: sanitizeCardText(n.text) || '(no text)',
        weekdayLabel: n.date ? formatWeekdayShort(n.date) : undefined,
        metadata: n.date ? formatDatePretty(n.date) : undefined,
        tags: n.tags,
      }))

    const fileCards: BoardCard[] = files
      .filter((f) =>
        (!showInbox || hasInboxTag(f.tags)) &&
        (!boardFilter ||
          f.name.toLowerCase().includes(boardFilter.toLowerCase()) ||
          (f.author ?? '').toLowerCase().includes(boardFilter.toLowerCase()) ||
          (f.syncPath ?? '').toLowerCase().includes(boardFilter.toLowerCase())),
      )
      .map((f) => ({
        id: f.id,
        type: f.type,
        title: f.name || (f.type === 'project' ? 'Project' : 'Reference Material'),
        metadata: f.type === 'project'
          ? (f.startDate ? formatDatePretty(f.startDate) : 'Project')
          : (f.author ? `by ${f.author}` : 'Reference'),
        snippet: f.syncPath || undefined,
        tags: f.tags,
      }))

    const currentTab = openTabs.find((tab) => tab.tabId === activeTabId) ?? null
    const selectedCardType: EditorObjectType | null = isCreating
      ? createType
      : currentTab?.type === 'topic-note' || currentTab?.type === 'daily-note' || currentTab?.type === 'habit' || currentTab?.type === 'project' || currentTab?.type === 'ref-material'
        ? currentTab.type
        : null
    const cards = [...topicCards, ...dailyCards, ...habitCards, ...fileCards]
    return cards.filter((card) => {
      if (activeFilterChips.cardType && selectedCardType && card.type !== selectedCardType) return false

      const hasTags = (card.tags?.length ?? 0) > 0
      if (activeFilterChips.tags !== activeFilterChips.untagged) {
        return activeFilterChips.tags ? hasTags : !hasTags
      }

      return true
    })
  }, [topicNotes, dailyNotes, habits, files, showInbox, boardFilter, activeFilterChips, openTabs, activeTabId, isCreating, createType])
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
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1, flexShrink: 0 }}>
        {/* Filter chip row */}
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ flex: 1, minWidth: 0, overflowX: 'auto', overflowY: 'hidden', py: 0.25 }}>
           <FilterChip
             icon={<TuneIcon />}
             label="Card type"
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
            placeholder="Find a card..."
            value={boardFilter}
            onChange={(e) => setBoardFilter(e.target.value)}
            variant="outlined"
            sx={{
              width: 220,
              flexShrink: 0,
              '& .MuiOutlinedInput-root': {
                minHeight: 30,
                fontSize: '12px',
                bgcolor: 'surface.sunken',
                color: 'text.secondary',
                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'border.strong' },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'accent.selected' },
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

          {/* +Card button */}
          <Button
            variant="outlined"
            size="small"
            onClick={handleNewNote}
            sx={{
              flexShrink: 0,
              fontSize: '12px',
              minHeight: 30,
              px: 1,
              py: 0.25,
              borderColor: 'border.subtle',
              color: 'text.secondary',
              bgcolor: 'surface.sunken',
              '&:hover': { borderColor: 'border.strong', bgcolor: 'surface.elevated' },
            }}
          >
            +Card
          </Button>

          {/* Inbox toggle */}
          <IconButton
            size="small"
            onClick={() => setShowInbox((v) => !v)}
            title={showInbox ? 'Show all notes' : 'Show Inbox only'}
            sx={{
              color: showInbox ? '#e8a84a' : '#4a6a8a',
              bgcolor: showInbox ? 'rgba(232,168,74,0.12)' : 'transparent',
              border: showInbox ? '1px solid rgba(232,168,74,0.4)' : '1px solid transparent',
              borderRadius: '6px',
              flexShrink: 0,
              '&:hover': { bgcolor: 'rgba(232,168,74,0.18)' },
            }}
          >
            <MoveToInboxIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Stack>
      </Stack>

      <Stack direction={isCreating || activeTab ? 'row' : 'column'} spacing={1.5} sx={{ flex: 1, minHeight: 0, width: '100%', minWidth: 0 }}>
       <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', width: '100%', minWidth: 0 }}>
         {/* ── Inbox banner ─────────────────────────────────── */}
         {showInbox && (
           <Stack
             direction="row"
             alignItems="center"
             spacing={0.75}
             sx={{ mb: 1, px: 1, py: 0.5, bgcolor: 'rgba(232,168,74,0.08)', borderRadius: '6px', border: '1px solid rgba(232,168,74,0.2)' }}
           >
             <MoveToInboxIcon sx={{ fontSize: 14, color: '#e8a84a' }} />
             <Typography variant="caption" sx={{ color: '#e8a84a', fontWeight: 600, fontSize: '11px' }}>
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
           <Typography variant="caption" sx={{ color: '#4a6a8a', fontStyle: 'italic', p: 1.5, display: 'block' }}>
             {boardFilter || showInbox || hasActiveBoardFilters ? 'No matches' : 'Nothing here yet'}
           </Typography>
         ) : (
           <Box
             sx={{
               display: 'grid',
               gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
               gap: 1.5,
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

      {(isCreating || activeTab) && (
        <Paper sx={{ width: 560, minWidth: 420, bgcolor: '#0e2038', border: '1px solid #1c3558', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {isCreating ? (
            <>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1.25, borderBottom: '1px solid #1c3558' }}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  Create New Note
                </Typography>
                <MuiIconButton size="small" onClick={handleCloseEditor}>
                  <CloseIcon fontSize="small" />
                </MuiIconButton>
              </Stack>
              <Box sx={{ p: 1.5, flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
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
                />
              </Box>
            </>
          ) : (
            <>
              <Stack direction="row" alignItems="center" gap={1} sx={{ px: 1, py: 0.75, borderBottom: '1px solid #1c3558' }}>
                <Tabs
                  value={activeTab?.tabId ?? false}
                  onChange={(_, value: string) => setActiveTabId(value)}
                  variant="scrollable"
                  scrollButtons="auto"
                  sx={{
                    minHeight: 36,
                    flex: 1,
                    '& .MuiTabs-indicator': { bgcolor: getObjectColor(activeTab?.type ?? 'daily-note').accent },
                    '& .MuiTab-root': { minHeight: 36, textTransform: 'none', minWidth: 0, px: 1 },
                  }}
                >
                  {openTabs.map((tab) => {
                    const tabToken = getObjectColor(tab.type)
                    return (
                      <Tab
                        key={tab.tabId}
                        value={tab.tabId}
                        label={(
                          <Stack direction="row" alignItems="center" spacing={0.5}>
                            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: tabToken.text, flexShrink: 0 }} />
                            <Typography variant="caption" sx={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {getTabLabel(tab)}
                            </Typography>
                            {tab.isDirty ? <Box sx={{ width: 6, height: 6, borderRadius: '999px', bgcolor: '#e8a84a' }} /> : null}
                            <MuiIconButton
                              size="small"
                              onClick={(event) => {
                                event.stopPropagation()
                                handleRequestCloseTab(tab.tabId)
                              }}
                              sx={{ p: 0.15, color: '#7dbad6' }}
                            >
                              <CloseIcon sx={{ fontSize: 12 }} />
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
          )}
        </Paper>
      )}
      </Stack>

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
