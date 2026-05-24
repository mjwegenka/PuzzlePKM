import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Chip, CircularProgress, Dialog, DialogContent, DialogTitle, Link, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import AutoStoriesIcon from '@mui/icons-material/AutoStories'
import { getObjectColor } from '../../lib/objectColors'
import { getScriptureById, listScriptureMeta, openPathInDefaultApp } from '../../lib/cliService'
import type { Scripture } from '../../shared/types'

interface ScripturePageProps {
  onOpenObjectTab?: (target: { id: string; type: 'topic-note' | 'daily-note'; forceNewTab?: boolean }) => void | Promise<void>
}

export default function ScripturePage({ onOpenObjectTab }: ScripturePageProps) {
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<Scripture[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selectedBook, setSelectedBook] = useState('all')
  const [selectedScriptureId, setSelectedScriptureId] = useState<string | null>(null)
  const color = useMemo(() => getObjectColor('scripture'), [])
  const books = useMemo(() => {
    const byName = new Map<string, number>()
    for (const item of items) {
      const existing = byName.get(item.bookName)
      if (existing == null || item.bookOrder < existing) {
        byName.set(item.bookName, item.bookOrder)
      }
    }
    return Array.from(byName.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([name]) => name)
  }, [items])
  const filteredItems = useMemo(
    () => (selectedBook === 'all' ? items : items.filter((item) => item.bookName === selectedBook)),
    [items, selectedBook],
  )
  const selectedScripture = useMemo(
    () => (selectedScriptureId ? items.find((item) => item.id === selectedScriptureId) ?? null : null),
    [items, selectedScriptureId],
  )

  const handleOpenPassage = async (event: React.MouseEvent<HTMLElement>, passageUrl: string) => {
    event.preventDefault()
    event.stopPropagation()
    try {
      await openPathInDefaultApp(passageUrl)
    } catch (err) {
      setError(String(err))
    }
  }

  const handleOpenLinkedNote = async (
    event: React.MouseEvent<HTMLElement>,
    note: { id: string; type: 'topic-note' | 'daily-note' },
  ) => {
    event.preventDefault()
    event.stopPropagation()
    if (!onOpenObjectTab) return
    try {
      await Promise.resolve(onOpenObjectTab({
        id: note.id,
        type: note.type,
        forceNewTab: event.metaKey || event.ctrlKey,
      }))
    } catch (err) {
      setError(String(err))
    }
  }

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const list = await listScriptureMeta()
        const detailed = await Promise.all(list.map((entry) => getScriptureById(entry.id)))
        if (cancelled) return
        setItems(detailed.filter((entry): entry is Scripture => Boolean(entry)))
      } catch (err) {
        if (cancelled) return
        setError(String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Stack alignItems="center" spacing={1.5}>
          <CircularProgress size={26} />
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>Loading scripture references…</Typography>
        </Stack>
      </Box>
    )
  }

  if (error) {
    return (
      <Box sx={{ p: 2.5 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    )
  }

  if (items.length === 0) {
    return (
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          color: 'text.disabled',
        }}
      >
        <AutoStoriesIcon sx={{ fontSize: 56, opacity: 0.35 }} />
        <Typography variant="h6" sx={{ fontWeight: 600, color: 'text.secondary' }}>
          Scripture
        </Typography>
        <Typography variant="body2" sx={{ textAlign: 'center', maxWidth: 380 }}>
          Save a Daily or Topic note with a scripture reference (for example, John 3:16) to populate this page.
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ flex: 1, p: 2.5, overflowY: 'auto' }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
          <Typography variant="subtitle2" sx={{ color: 'text.primary', fontWeight: 700 }}>
            Scripture objects ({filteredItems.length})
          </Typography>
          <TextField
            select
            size="small"
            label="Book"
            value={selectedBook}
            onChange={(event) => setSelectedBook(event.target.value)}
            sx={{ minWidth: 220 }}
          >
            <MenuItem value="all">All books</MenuItem>
            {books.map((book) => (
              <MenuItem key={book} value={book}>
                {book}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        {filteredItems.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.disabled', fontStyle: 'italic', py: 2 }}>
            No scripture references match this book filter.
          </Typography>
        ) : filteredItems.map((item) => (
          <Paper
            key={item.id}
            onClick={() => setSelectedScriptureId(item.id)}
            sx={{
              p: 1.75,
              bgcolor: color.bg,
              border: `1px solid ${color.border}`,
              cursor: 'pointer',
              transition: 'filter 0.12s ease',
              '&:hover': { filter: 'brightness(1.08)' },
            }}
          >
            <Stack spacing={1}>
              <Typography
                variant="subtitle2"
                onClick={() => setSelectedScriptureId(item.id)}
                sx={{ color: color.text, fontWeight: 700 }}
              >
                {item.reference}
              </Typography>
              <Link
                component="button"
                underline="hover"
                onClick={(event) => { void handleOpenPassage(event, item.passageUrl) }}
                sx={{ color: 'accent.link', width: 'fit-content', fontSize: '12px' }}
              >
                Open on Bible Gateway
              </Link>
              <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                {item.bookName}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Linked notes
              </Typography>
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                {item.linkedNotes.length === 0 ? (
                  <Typography variant="caption" sx={{ color: 'text.disabled', fontStyle: 'italic' }}>
                    No linked notes
                  </Typography>
                ) : item.linkedNotes.map((note) => (
                  <Chip
                    key={`${item.id}-${note.id}`}
                    size="small"
                    label={note.type === 'daily-note' ? (note.date || note.id) : (note.title || note.id)}
                    onClick={(event) => { void handleOpenLinkedNote(event, note) }}
                    sx={{
                      bgcolor: 'surface.sunken',
                      border: '1px solid',
                      borderColor: 'border.strong',
                      color: 'text.primary',
                      cursor: 'pointer',
                    }}
                  />
                ))}
              </Stack>
            </Stack>
          </Paper>
        ))}
      </Stack>

      <Dialog
        open={Boolean(selectedScripture)}
        onClose={() => setSelectedScriptureId(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle sx={{ fontWeight: 700 }}>
          {selectedScripture?.reference ?? 'Scripture'}
        </DialogTitle>
        <DialogContent>
          {selectedScripture ? (
            <Stack spacing={1.25} sx={{ pt: 0.5 }}>
              <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                Book: {selectedScripture.bookName}
              </Typography>
              <Link
                component="button"
                underline="hover"
                onClick={(event) => { void handleOpenPassage(event, selectedScripture.passageUrl) }}
                sx={{ color: color.text, fontWeight: 600, width: 'fit-content' }}
              >
                Open Bible Gateway passage
              </Link>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Linked notes
              </Typography>
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                {selectedScripture.linkedNotes.length === 0 ? (
                  <Typography variant="caption" sx={{ color: 'text.disabled', fontStyle: 'italic' }}>
                    No linked notes
                  </Typography>
                ) : selectedScripture.linkedNotes.map((note) => (
                  <Chip
                    key={`${selectedScripture.id}-${note.id}`}
                    size="small"
                    label={note.type === 'daily-note' ? (note.date || note.id) : (note.title || note.id)}
                    onClick={(event) => { void handleOpenLinkedNote(event, note) }}
                    sx={{
                      bgcolor: 'surface.sunken',
                      border: '1px solid',
                      borderColor: 'border.strong',
                      color: 'text.primary',
                      cursor: 'pointer',
                    }}
                  />
                ))}
              </Stack>
            </Stack>
          ) : null}
        </DialogContent>
      </Dialog>
    </Box>
  )
}
