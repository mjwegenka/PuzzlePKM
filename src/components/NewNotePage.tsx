import React, { useState } from 'react'
import {
  Box,
  Stack,
  Paper,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material'
import NoteAddIcon from '@mui/icons-material/NoteAdd'
import CalendarTodayIcon from '@mui/icons-material/CalendarToday'
import RepeatIcon from '@mui/icons-material/Repeat'
import ObjectEditor from './ObjectEditor'
import { getTodayDate } from '../lib/dateUtils'

type NoteType = 'topic-note' | 'daily-note' | 'habit'

interface NewNotePageProps {
  onSaved?: () => void
}

export default function NewNotePage({ onSaved }: NewNotePageProps) {
  const [noteType, setNoteType] = useState<NoteType>('topic-note')
  const [editorKey, setEditorKey] = useState(0) // force re-mount on type change

  const handleTypeChange = (_: React.MouseEvent, value: NoteType | null) => {
    if (value) {
      setNoteType(value)
      setEditorKey((k) => k + 1)
    }
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
        <NoteAddIcon sx={{ color: '#4f8fed', fontSize: 28 }} />
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            New Note
          </Typography>
          <Typography variant="caption" sx={{ color: '#b8bec8' }}>
            Create a new note in your knowledge base
          </Typography>
        </Box>
      </Stack>

      {/* Type switcher */}
      <Paper sx={{ p: 2, bgcolor: '#1a1c1f', border: '1px solid rgba(255,255,255,0.09)', flexShrink: 0 }}>
        <Typography
          variant="caption"
          sx={{
            fontWeight: 700,
            color: '#b8bec8',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontSize: '10px',
            display: 'block',
            mb: 1.5,
          }}
        >
          Note type
        </Typography>
        <ToggleButtonGroup
          value={noteType}
          exclusive
          onChange={handleTypeChange}
          size="small"
          sx={{
            '& .MuiToggleButton-root': {
              color: '#b8bec8',
              borderColor: 'rgba(255,255,255,0.09)',
              borderRightColor: 'rgba(255,255,255,0.09)',
              px: 2.5,
              py: 0.75,
              fontSize: '13px',
              '&.Mui-selected': {
                bgcolor: 'rgba(79,143,237,0.25)',
                color: '#eceff3',
                borderColor: '#4f8fed',
                borderRightColor: '#4f8fed',
              },
            },
            '& .MuiToggleButtonGroup-grouped:not(:last-of-type)': {
              borderRight: '1px solid rgba(255,255,255,0.09) !important',
            },
            '& .MuiToggleButtonGroup-grouped.Mui-selected:not(:last-of-type)': {
              borderRight: '1px solid #4f8fed !important',
            },
            '& .MuiToggleButtonGroup-grouped + .MuiToggleButtonGroup-grouped.Mui-selected': {
              marginLeft: 0,
              borderLeft: '1px solid #4f8fed',
            },
            '& .MuiToggleButtonGroup-grouped + .MuiToggleButtonGroup-grouped': {
              marginLeft: 0,
              borderLeft: '1px solid rgba(255,255,255,0.09)',
            },
            '& .MuiToggleButtonGroup-firstButton': {
              borderTopRightRadius: 0,
              borderBottomRightRadius: 0,
            },
            '& .MuiToggleButtonGroup-middleButton': {
              borderRadius: 0,
            },
            '& .MuiToggleButtonGroup-lastButton': {
              borderTopLeftRadius: 0,
              borderBottomLeftRadius: 0,
            },
          }}
        >
          <ToggleButton value="topic-note">
            <NoteAddIcon sx={{ fontSize: 16, mr: 0.75 }} />
            Topic Note
          </ToggleButton>
          <ToggleButton value="daily-note">
            <CalendarTodayIcon sx={{ fontSize: 16, mr: 0.75 }} />
            Daily Note
          </ToggleButton>
          <ToggleButton value="habit">
            <RepeatIcon sx={{ fontSize: 16, mr: 0.75 }} />
            Habit
          </ToggleButton>
        </ToggleButtonGroup>

        {/* Hint text per type */}
        <Typography variant="caption" sx={{ color: '#9198a3', display: 'block', mt: 1.25 }}>
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

