import React, { useState } from 'react'
import {
  Box,
  Stack,
  Paper,
  Typography,
} from '@mui/material'
import NoteAddIcon from '@mui/icons-material/NoteAdd'
import CalendarTodayIcon from '@mui/icons-material/CalendarToday'
import RepeatIcon from '@mui/icons-material/Repeat'
import ObjectEditor from '../objects/ObjectEditor'
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs'
import { getTodayDate } from '../../lib/dateUtils'

type NoteType = 'topic-note' | 'daily-note' | 'habit'

interface NewNotePageProps {
  onSaved?: () => void
}

export default function NewNotePage({ onSaved }: NewNotePageProps) {
  const [noteType, setNoteType] = useState<NoteType>('topic-note')
  const [editorKey, setEditorKey] = useState(0) // force re-mount on type change

  const handleTypeChange = (value: string) => {
    setNoteType(value as NoteType)
    setEditorKey((k) => k + 1)
  }

  const blankObject =
    noteType === 'daily-note'
      ? { date: getTodayDate(), contentMarkdown: '', tags: [], linkedObjectIds: [] }
      : noteType === 'topic-note'
        ? { title: '', date: '', contentMarkdown: '', tags: [], linkedObjectIds: [] }
        : { date: getTodayDate(), contentMarkdown: '', tags: [] }

  const handleSave = (saved: Record<string, unknown>) => {
    // Reset editor to a fresh blank form after save
    void saved
    setEditorKey((k) => k + 1)
    onSaved?.()
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: 2 }}>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={2} sx={{ flexShrink: 0 }}>
        <NoteAddIcon sx={{ color: 'accent.selected', fontSize: 28 }} />
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            New Note
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Create a new note in your knowledge base
          </Typography>
        </Box>
      </Stack>

      {/* Type switcher */}
      <Paper sx={{ p: 2, bgcolor: 'surface.elevated', border: '1px solid', borderColor: 'border.subtle', flexShrink: 0 }}>
        <Typography
          variant="caption"
          sx={{
            fontWeight: 700,
            color: 'text.secondary',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontSize: '10px',
            display: 'block',
            mb: 1.5,
          }}
        >
          Note type
        </Typography>
        <Tabs value={noteType} onValueChange={handleTypeChange}>
          <TabsList className="grid h-10 w-full max-w-lg grid-cols-3 bg-slate-950 p-1 text-slate-400">
            <TabsTrigger value="topic-note" className="gap-2 px-3 text-xs data-[state=active]:bg-slate-900 data-[state=active]:text-slate-100">
              <NoteAddIcon sx={{ fontSize: 16 }} />
              Topic Note
            </TabsTrigger>
            <TabsTrigger value="daily-note" className="gap-2 px-3 text-xs data-[state=active]:bg-slate-900 data-[state=active]:text-slate-100">
              <CalendarTodayIcon sx={{ fontSize: 16 }} />
              Daily Note
            </TabsTrigger>
            <TabsTrigger value="habit" className="gap-2 px-3 text-xs data-[state=active]:bg-slate-900 data-[state=active]:text-slate-100">
              <RepeatIcon sx={{ fontSize: 16 }} />
              Habit
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Hint text per type */}
        <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block', mt: 1.25 }}>
          {noteType === 'topic-note'
            ? 'Topic notes are titled notes on any subject. They can link to other objects using @mentions.'
            : noteType === 'daily-note'
              ? 'Daily notes are journal entries tied to a specific date. Each date has one daily note.'
              : 'Habits are date-scoped tracking notes for routines and repeat actions.'}
        </Typography>
      </Paper>

      {/* Editor */}
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <ObjectEditor
          key={editorKey}
          object={blankObject}
          type={noteType}
          onSave={handleSave}
        />
      </Box>
    </Box>
  )
}
