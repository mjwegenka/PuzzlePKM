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
  IconButton as MuiIconButton,
} from '@mui/material'
import NoteAddIcon from '@mui/icons-material/NoteAdd'
import CalendarTodayIcon from '@mui/icons-material/CalendarToday'
import RepeatIcon from '@mui/icons-material/Repeat'
import ArticleIcon from '@mui/icons-material/Article'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
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
  onSelect: (id: string) => void
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
                  onClick={() => onSelect(item.id)}
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

export default function NotesPage({ onSaved }: NotesPageProps) {
  const [topicNotes, setTopicNotes] = useState<TopicItem[]>([])
  const [dailyNotes, setDailyNotes] = useState<DailyItem[]>([])
  const [habits, setHabits] = useState<HabitItem[]>([])
  const [loading, setLoading] = useState(false)

  // Selection
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedType, setSelectedType] = useState<EditorObjectType | null>(null)
  const [selectedObject, setSelectedObject] = useState<Record<string, unknown> | null>(null)

  // Create mode
  const [isCreating, setIsCreating] = useState(false)
  const [createType, setCreateType] = useState<NoteType>('topic-note')
  const [createKey, setCreateKey] = useState(0)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [showConfirmClose, setShowConfirmClose] = useState(false)

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

  const handleSelectItem = useCallback(async (id: string, type: NoteType) => {
    setIsCreating(false)
    setSelectedId(id)
    setSelectedType(type)
    try {
      const full = await getObject(type, id)
      setSelectedObject({ ...full, type })
    } catch {
      setSelectedObject(null)
    }
  }, [])

  const handleNavigateToObject = useCallback(async (target: ResolvedObjectRef) => {
    try {
      const full = await getObject(target.type, target.id)
      if (full && typeof full === 'object') {
        setIsCreating(false)
        setSelectedId(target.id)
        setSelectedType(target.type)
        setSelectedObject({ ...full, type: target.type })
        setHasUnsavedChanges(false)
        return
      }
    } catch {
      // Some older/stale habit rows can fail direct `get`; fall back to list metadata by ID.
    }

    if (target.type === 'habit') {
      const habitsMeta = await listHabitMeta()
      const targetPath = normalizePathForLookup(target.syncPath ?? target.dropboxPath)
      const fallback = habitsMeta.find((item) => item.id === target.id)
        ?? habitsMeta.find((item) => normalizePathForLookup(item.syncPath ?? item.dropboxPath) === targetPath)
      if (fallback) {
        try {
          const fullFallback = await getObject('habit', fallback.id)
          setIsCreating(false)
          setSelectedId(fallback.id)
          setSelectedType('habit')
          setSelectedObject({ ...fullFallback, type: 'habit' })
          setHasUnsavedChanges(false)
          return
        } catch {
          // Fall through to metadata-only fallback.
        }
        setIsCreating(false)
        setSelectedId(fallback.id)
        setSelectedType('habit')
        setSelectedObject({ ...fallback, type: 'habit' })
        setHasUnsavedChanges(false)
      }
    }
  }, [])

  const handleNewNote = () => {
    setSelectedId(null)
    setSelectedType(null)
    setSelectedObject(null)
    setHasUnsavedChanges(false)
    setIsCreating(true)
    setCreateKey((k) => k + 1)
  }

  const handleCreateDateChange = useCallback(async (date: string) => {
    if (!isCreating || createType !== 'daily-note') return
    const existing = dailyNotes.find((note) => note.date === date)
    if (!existing) return

    setIsCreating(false)
    setSelectedId(existing.id)
    setSelectedType('daily-note')
    try {
      const full = await getObject('daily-note', existing.id)
      setSelectedObject({ ...full, type: 'daily-note' })
      setHasUnsavedChanges(false)
    } catch {
      setSelectedObject(null)
    }
  }, [createType, dailyNotes, isCreating])

  const handleSaveNew = (saved: Record<string, unknown>) => {
    void saved
    setHasUnsavedChanges(false)
    setIsCreating(false)
    loadAll()
    onSaved?.()
  }

  const handleSaveEdit = (saved: Record<string, unknown>) => {
    void saved
    setHasUnsavedChanges(false)
    setSelectedId(null)
    setSelectedObject(null)
    setIsCreating(false)
    loadAll()
  }

   const handleCloseEditor = () => {
     if (hasUnsavedChanges) {
       setShowConfirmClose(true)
       return
     }
     setSelectedId(null)
     setSelectedObject(null)
     setIsCreating(false)
     setHasUnsavedChanges(false)
   }

   const handleConfirmClose = () => {
     setShowConfirmClose(false)
     setSelectedId(null)
     setSelectedObject(null)
     setIsCreating(false)
     setHasUnsavedChanges(false)
   }

   // Filtered lists
  const filteredTopics = topicNotes.filter((n) =>
    n.title.toLowerCase().includes(topicFilter.toLowerCase()) ||
    n.preview.toLowerCase().includes(topicFilter.toLowerCase()),
  )
  const filteredDailies = dailyNotes.filter(
    (n) =>
      n.date.includes(dailyFilter) ||
      formatDatePretty(n.date).toLowerCase().includes(dailyFilter.toLowerCase()) ||
      n.preview?.toLowerCase().includes(dailyFilter.toLowerCase()),
  )
  const filteredHabits = habits.filter(
    (n) =>
      n.text.toLowerCase().includes(habitFilter.toLowerCase()) ||
      n.date.includes(habitFilter) ||
      formatDatePretty(n.date).toLowerCase().includes(habitFilter.toLowerCase()),
  )

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

       {/* ── 3-column list ────────────────────────────────── */}
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
           selectedId={selectedType === 'topic-note' ? selectedId : null}
           onSelect={(id) => handleSelectItem(id, 'topic-note')}
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
           selectedId={selectedType === 'daily-note' ? selectedId : null}
           onSelect={(id) => handleSelectItem(id, 'daily-note')}
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
           selectedId={selectedType === 'habit' ? selectedId : null}
           onSelect={(id) => handleSelectItem(id, 'habit')}
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
             onDirty={setHasUnsavedChanges}
             onNavigateToObject={handleNavigateToObject}
             onCreateDateChange={handleCreateDateChange}
           />
         </DialogContent>
       </Dialog>

       {/* ── Edit Modal Dialog ── */}
       <Dialog
         open={!!selectedObject && !isCreating}
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
             {selectedType === 'daily-note' ? '📓 Daily Note'
               : selectedType === 'habit' ? '🔁 Habit'
               : selectedType === 'project' ? '📁 Project'
               : selectedType === 'ref-material' ? '📚 Reference Material'
               : '📝 Topic Note'}
           </Typography>
           <MuiIconButton size="small" onClick={handleCloseEditor} sx={{ ml: 'auto' }}>
             <CloseIcon fontSize="small" />
           </MuiIconButton>
         </DialogTitle>
         <DialogContent dividers sx={{ p: 2, bgcolor: '#0e2038', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {selectedObject && selectedType ? (
              <EditorErrorBoundary>
                <ObjectEditor
                  object={selectedObject}
                  type={selectedType}
                  onSave={handleSaveEdit}
                  onCancel={handleCloseEditor}
                  onDirty={setHasUnsavedChanges}
                  onNavigateToObject={handleNavigateToObject}
                />
              </EditorErrorBoundary>
            ) : null}
         </DialogContent>
       </Dialog>

       {/* Confirmation Dialog for unsaved changes */}
       <Dialog
         open={showConfirmClose}
         onClose={() => setShowConfirmClose(false)}
       >
         <DialogTitle>Unsaved Changes</DialogTitle>
         <DialogContent>
           <Typography>
             You have unsaved changes. Are you sure you want to close without saving?
           </Typography>
         </DialogContent>
         <DialogActions>
           <Button onClick={() => setShowConfirmClose(false)}>Cancel</Button>
           <Button onClick={handleConfirmClose} variant="contained" color="error">
             Discard Changes
           </Button>
         </DialogActions>
       </Dialog>
     </Box>
   )
}
