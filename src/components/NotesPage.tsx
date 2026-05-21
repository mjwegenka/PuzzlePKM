import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Box,
  Stack,
  Paper,
  Typography,
  Button,
  TextField,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  CircularProgress,
  Divider,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Chip,
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
import ArticleIcon from '@mui/icons-material/Article'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import MoveToInboxIcon from '@mui/icons-material/MoveToInbox'
import ObjectEditor from './ObjectEditor'
import EditorErrorBoundary from './EditorErrorBoundary'
import { listTopicNoteMeta, listDailyNoteMeta, listHabitMeta, getObject } from '../lib/cliService'
import type { ResolvedObjectRef } from '../lib/cliService'
import { formatDatePretty, getTodayDate } from '../lib/dateUtils'

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
  pendingSelection?: { id: string; type: NoteType; nonce: number } | null
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

interface OpenEditorTab {
  tabId: string
  objectId: string
  type: EditorObjectType
  object: Record<string, unknown>
  isDirty: boolean
}

// ── Column component ──────────────────────────────────────────────────────────

interface ColumnItem {
  id: string
  primary: string
  secondary?: string
  tags?: string[]
}

interface NoteColumnProps {
  title: string
  icon: React.ReactNode
  accentColor: string
  items: ColumnItem[]
  loading: boolean
  filter: string
  onFilterChange: (v: string) => void
  selectedId: string | null
  onSelect: (id: string, options?: { forceNewTab?: boolean }) => void
}

function NoteColumn({
  title,
  icon,
  accentColor,
  items,
  loading,
  filter,
  onFilterChange,
  selectedId,
  onSelect,
}: NoteColumnProps) {
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
      {/* Column header */}
      <Stack
        direction="row"
        alignItems="center"
        spacing={0.75}
        sx={{ px: 1.5, pt: 1.5, pb: 1, flexShrink: 0 }}
      >
        <Box sx={{ color: accentColor, display: 'flex', alignItems: 'center' }}>{icon}</Box>
        <Typography
          variant="caption"
          sx={{
            fontWeight: 700,
            color: accentColor,
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            fontSize: '10px',
          }}
        >
          {title}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" sx={{ color: '#4a6a8a', fontSize: '10px' }}>
          {items.length}
        </Typography>
      </Stack>

      {/* Filter */}
      <Box sx={{ px: 1.5, pb: 1, flexShrink: 0 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Filter…"
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          variant="outlined"
          sx={{
            '& .MuiOutlinedInput-root': { fontSize: '12px', bgcolor: 'rgba(0,0,0,0.2)' },
            '& .MuiOutlinedInput-notchedOutline': { borderColor: '#1c3558' },
          }}
        />
      </Box>

      <Divider sx={{ borderColor: '#1c3558' }} />

      {/* Item list */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={20} />
        </Box>
      ) : items.length === 0 ? (
        <Typography
          variant="caption"
          sx={{ color: '#4a6a8a', fontStyle: 'italic', p: 1.5, display: 'block' }}
        >
          {filter ? 'No matches' : 'Nothing here yet'}
        </Typography>
      ) : (
        <List sx={{ p: 0, flex: 1, overflow: 'auto' }}>
          {items.map((item) => (
            <React.Fragment key={item.id}>
              <ListItem disablePadding>
                <ListItemButton
                  selected={selectedId === item.id}
                  onClick={(event) => onSelect(item.id, { forceNewTab: event.metaKey || event.ctrlKey })}
                  title="Click to open • Ctrl/Cmd-click to open in new tab"
                  sx={{
                    py: 0.75,
                    px: 1.5,
                    '&.Mui-selected': { bgcolor: `rgba(26,138,181,0.18)` },
                    '&:hover': { bgcolor: 'rgba(26,138,181,0.1)' },
                  }}
                >
                  <ListItemText
                    primary={
                      <Typography
                        variant="body2"
                        sx={{
                          fontSize: '12.5px',
                          fontWeight: 500,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {item.primary || '(untitled)'}
                      </Typography>
                    }
                    secondary={
                      item.secondary ? (
                        <Typography
                          variant="caption"
                          sx={{
                            color: '#4a6a8a',
                            fontSize: '11px',
                            display: 'block',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {item.secondary}
                        </Typography>
                      ) : undefined
                    }
                    disableTypography
                  />
                  {item.tags && item.tags.length > 0 && (
                    <Box sx={{ ml: 0.5, flexShrink: 0 }}>
                      <Chip
                        label={`+${item.tags.length}`}
                        size="small"
                        sx={{
                          height: 16,
                          fontSize: '9px',
                          bgcolor: 'rgba(26,138,181,0.12)',
                          color: '#7dbad6',
                          border: '1px solid rgba(26,138,181,0.25)',
                        }}
                      />
                    </Box>
                  )}
                </ListItemButton>
              </ListItem>
              <Divider sx={{ borderColor: 'rgba(28,53,88,0.4)' }} />
            </React.Fragment>
          ))}
        </List>
      )}
    </Paper>
  )
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

export default function NotesPage({ onSaved, pendingSelection }: NotesPageProps) {
  const [topicNotes, setTopicNotes] = useState<TopicItem[]>([])
  const [dailyNotes, setDailyNotes] = useState<DailyItem[]>([])
  const [habits, setHabits] = useState<HabitItem[]>([])
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

  // Column filters
  const [topicFilter, setTopicFilter] = useState('')
  const [dailyFilter, setDailyFilter] = useState('')
  const [habitFilter, setHabitFilter] = useState('')

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [topicsRes, dailiesRes, habitsRes] = await Promise.allSettled([
        listTopicNoteMeta(),
        listDailyNoteMeta(),
        listHabitMeta(),
      ])
      if (topicsRes.status === 'fulfilled')
        setTopicNotes(topicsRes.value as TopicItem[])
      if (dailiesRes.status === 'fulfilled')
        setDailyNotes(dailiesRes.value as DailyItem[])
      if (habitsRes.status === 'fulfilled')
        setHabits(habitsRes.value as HabitItem[])
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
      loadedObject = { ...(full as Record<string, unknown>), type }
    } catch {
      if (type === 'habit') {
        const habitsMeta = await listHabitMeta()
        const fallback = habitsMeta.find((item) => item.id === objectId)
        if (fallback) {
          try {
            const fullFallback = await getObject('habit', fallback.id)
            loadedObject = { ...(fullFallback as Record<string, unknown>), type: 'habit' }
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

  const handleSelectItem = useCallback(async (id: string, type: NoteType, options?: { forceNewTab?: boolean }) => {
    await openObjectInTab(id, type, options)
  }, [openObjectInTab])

  useEffect(() => {
    if (!pendingSelection) return
    void handleSelectItem(pendingSelection.id, pendingSelection.type)
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

   // Filtered lists
  const hasInboxTag = (tags: string[]) => tags.some((t) => t.toLowerCase() === 'inbox')
  const filteredTopics = topicNotes.filter((n) =>
    (!showInbox || hasInboxTag(n.tags)) &&
    (n.title.toLowerCase().includes(topicFilter.toLowerCase()) ||
    n.preview.toLowerCase().includes(topicFilter.toLowerCase())),
  )
  const filteredDailies = dailyNotes.filter(
    (n) =>
      (!showInbox || hasInboxTag(n.tags)) &&
      (n.date.includes(dailyFilter) ||
      formatDatePretty(n.date).toLowerCase().includes(dailyFilter.toLowerCase()) ||
      n.preview?.toLowerCase().includes(dailyFilter.toLowerCase())),
  )
  const filteredHabits = habits.filter(
    (n) =>
      (!showInbox || hasInboxTag(n.tags)) &&
      (n.text.toLowerCase().includes(habitFilter.toLowerCase()) ||
      n.date.includes(habitFilter) ||
      formatDatePretty(n.date).toLowerCase().includes(habitFilter.toLowerCase())),
  )
  const activeTab = openTabs.find((tab) => tab.tabId === activeTabId) ?? null
  const activeNoteType = activeTab?.type === 'topic-note' || activeTab?.type === 'daily-note' || activeTab?.type === 'habit'
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
     <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
       {/* ── Header ───────────────────────────────────────────────────────────── */}
       <Stack
         direction="row"
         alignItems="center"
         justifyContent="space-between"
         sx={{ mb: 1.5, flexShrink: 0 }}
       >
         <Stack direction="row" alignItems="center" spacing={1.5}>
           <ArticleIcon sx={{ color: '#1a8ab5', fontSize: 26 }} />
           <Box>
             <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
               Notes
             </Typography>
             <Typography variant="caption" sx={{ color: '#7dbad6' }}>
               Topic notes, daily notes &amp; habits
             </Typography>
           </Box>
         </Stack>
         <Stack direction="row" alignItems="center" spacing={1}>
           <IconButton
             size="small"
             onClick={() => setShowInbox((v) => !v)}
             title={showInbox ? 'Show all notes' : 'Show Inbox only'}
             sx={{
               color: showInbox ? '#e8a84a' : '#4a6a8a',
               bgcolor: showInbox ? 'rgba(232,168,74,0.12)' : 'transparent',
               border: showInbox ? '1px solid rgba(232,168,74,0.4)' : '1px solid transparent',
               borderRadius: '6px',
               '&:hover': { bgcolor: 'rgba(232,168,74,0.18)' },
             }}
           >
             <MoveToInboxIcon sx={{ fontSize: 18 }} />
           </IconButton>
           <Button
             variant="contained"
             size="small"
             startIcon={<AddIcon />}
             onClick={handleNewNote}
             sx={{ flexShrink: 0 }}
           >
             New Note
           </Button>
         </Stack>
       </Stack>

       {/* ── 3-column list ────────────────────────────────── */}
       {showInbox && (
         <Stack
           direction="row"
           alignItems="center"
           spacing={0.75}
           sx={{ mb: 1, px: 1, py: 0.5, bgcolor: 'rgba(232,168,74,0.08)', borderRadius: '6px', border: '1px solid rgba(232,168,74,0.2)', flexShrink: 0 }}
         >
           <MoveToInboxIcon sx={{ fontSize: 14, color: '#e8a84a' }} />
           <Typography variant="caption" sx={{ color: '#e8a84a', fontWeight: 600, fontSize: '11px' }}>
             Inbox — showing only newly imported objects tagged Inbox
           </Typography>
         </Stack>
       )}
       <Stack direction="row" spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
         {/* Topic Notes */}
         <NoteColumn
           title="Topic Notes"
           icon={<NoteAddIcon sx={{ fontSize: 14 }} />}
           accentColor="#7dcfaa"
           items={filteredTopics.map((n) => ({
             id: n.id,
             primary: n.title || '(untitled)',
              secondary: n.preview || (n.date ? formatDatePretty(n.date) : undefined),
             tags: n.tags,
           }))}
            loading={loading}
            filter={topicFilter}
            onFilterChange={setTopicFilter}
            selectedId={activeNoteType === 'topic-note' ? activeNoteId : null}
            onSelect={(id, options) => void handleSelectItem(id, 'topic-note', options)}
          />

         {/* Daily Notes */}
         <NoteColumn
           title="Daily Notes"
           icon={<CalendarTodayIcon sx={{ fontSize: 14 }} />}
           accentColor="#7dbad6"
           items={filteredDailies.map((n) => ({
             id: n.id,
              primary: formatDatePretty(n.date),
             secondary: n.preview || undefined,
             tags: n.tags,
           }))}
            loading={loading}
            filter={dailyFilter}
            onFilterChange={setDailyFilter}
            selectedId={activeNoteType === 'daily-note' ? activeNoteId : null}
            onSelect={(id, options) => void handleSelectItem(id, 'daily-note', options)}
          />

         {/* Habits */}
         <NoteColumn
           title="Habits"
           icon={<RepeatIcon sx={{ fontSize: 14 }} />}
           accentColor="#e8a84a"
           items={filteredHabits.map((n) => ({
             id: n.id,
             primary: n.text || '(no text)',
              secondary: n.date ? formatDatePretty(n.date) : undefined,
             tags: n.tags,
           }))}
            loading={loading}
            filter={habitFilter}
            onFilterChange={setHabitFilter}
            selectedId={activeNoteType === 'habit' ? activeNoteId : null}
            onSelect={(id, options) => void handleSelectItem(id, 'habit', options)}
          />
        </Stack>

       {/* ── Create Modal Dialog ── */}
       <Dialog
         open={isCreating}
         onClose={handleCloseEditor}
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
             Create New Note
           </Typography>
           <MuiIconButton size="small" onClick={handleCloseEditor} sx={{ ml: 'auto' }}>
             <CloseIcon fontSize="small" />
           </MuiIconButton>
         </DialogTitle>
         <DialogContent dividers sx={{ p: 2, bgcolor: '#0e2038', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
         </DialogContent>
       </Dialog>

        {/* ── Edit Modal Dialog ── */}
        <Dialog
          open={!!activeTab && !isCreating}
          onClose={handleCloseEditor}
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
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 0.5, flexShrink: 0 }}>
            <Tabs
              value={activeTab?.tabId ?? false}
              onChange={(_, value: string) => setActiveTabId(value)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{
                minHeight: 36,
                flex: 1,
                '& .MuiTabs-indicator': { bgcolor: '#1a8ab5' },
                '& .MuiTab-root': { minHeight: 36, textTransform: 'none', minWidth: 0, px: 1 },
              }}
            >
              {openTabs.map((tab) => (
                <Tab
                  key={tab.tabId}
                  value={tab.tabId}
                  label={(
                    <Stack direction="row" alignItems="center" spacing={0.5}>
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
              ))}
            </Tabs>
            <MuiIconButton size="small" onClick={handleCloseEditor} sx={{ ml: 'auto' }}>
              <CloseIcon fontSize="small" />
            </MuiIconButton>
          </DialogTitle>
          <DialogContent dividers sx={{ p: 2, bgcolor: '#0e2038', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
