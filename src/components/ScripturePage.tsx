import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Chip, CircularProgress, Link, Paper, Stack, Typography } from '@mui/material'
import AutoStoriesIcon from '@mui/icons-material/AutoStories'
import { getObjectColor } from '../lib/objectColors'
import { getScriptureById, listScriptureMeta } from '../lib/cliService'
import type { Scripture } from '../shared/types'

export default function ScripturePage() {
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<Scripture[]>([])
  const [error, setError] = useState<string | null>(null)
  const color = useMemo(() => getObjectColor('scripture'), [])

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
          <Typography variant="body2" sx={{ color: '#9db6d1' }}>Loading scripture references…</Typography>
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
          color: '#4a6a8a',
        }}
      >
        <AutoStoriesIcon sx={{ fontSize: 56, opacity: 0.35 }} />
        <Typography variant="h6" sx={{ fontWeight: 600, color: '#7dbad6' }}>
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
        {items.map((item) => (
          <Paper
            key={item.id}
            sx={{
              p: 1.75,
              bgcolor: color.bg,
              border: `1px solid ${color.border}`,
            }}
          >
            <Stack spacing={1}>
              <Link href={item.passageUrl} target="_blank" rel="noreferrer" underline="hover" sx={{ color: color.text, fontWeight: 700 }}>
                {item.reference}
              </Link>
              <Typography variant="caption" sx={{ color: '#b3c9df' }}>
                Linked notes
              </Typography>
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                {item.linkedNotes.length === 0 ? (
                  <Typography variant="caption" sx={{ color: '#7f9ab7', fontStyle: 'italic' }}>
                    No linked notes
                  </Typography>
                ) : item.linkedNotes.map((note) => (
                  <Chip
                    key={`${item.id}-${note.id}`}
                    size="small"
                    label={note.type === 'daily-note' ? (note.date || note.id) : (note.title || note.id)}
                    sx={{
                      bgcolor: 'rgba(14,32,56,0.55)',
                      border: '1px solid rgba(125,186,214,0.35)',
                      color: '#d7e7f6',
                    }}
                  />
                ))}
              </Stack>
            </Stack>
          </Paper>
        ))}
      </Stack>
    </Box>
  )
}
