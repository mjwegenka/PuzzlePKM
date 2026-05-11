import { useState, useEffect, useRef, KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  CircularProgress,
  Dialog,
  DialogContent,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { SearchResult } from '../shared/types'
import { useUIStore } from '../store/uiStore'

const TYPE_LABELS: Record<string, string> = {
  'topic-note': 'Topic Note',
  'daily-note': 'Daily Note',
  'project': 'Project',
  'ref-material': 'Reference',
  'habit': 'Habit',
  'tag': 'Tag',
}

export default function SearchModal() {
  const { isSearchOpen, setSearchOpen } = useUIStore()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (isSearchOpen) {
      setQuery('')
      setResults([])
      setSelectedIdx(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isSearchOpen])

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }
    const id = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await window.dropith.search(query)
        setResults(res.data ?? [])
        setSelectedIdx(0)
      } finally {
        setLoading(false)
      }
    }, 200)
    return () => clearTimeout(id)
  }, [query])

  const navigateToResult = (result: SearchResult) => {
    setSearchOpen(false)
    if (result.type === 'topic-note') navigate(`/topic/${result.id}`)
    else if (result.type === 'daily-note') navigate(`/daily/${result.title}`)
    else if (result.type === 'project') navigate(`/projects?focus=${result.id}`)
    else if (result.type === 'ref-material') navigate(`/references?focus=${result.id}`)
    else if (result.type === 'habit') navigate(`/habits?focus=${result.id}`)
    else if (result.type === 'tag') navigate(`/tags?focus=${result.id}`)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setSearchOpen(false); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, results.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)) }
    if (e.key === 'Enter' && results[selectedIdx]) { navigateToResult(results[selectedIdx]) }
  }

  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.type]) acc[r.type] = []
    acc[r.type].push(r)
    return acc
  }, {})

  return (
    <Dialog open={isSearchOpen} onClose={() => setSearchOpen(false)} fullWidth maxWidth="md">
      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ px: 2, py: 1.5 }}>
          <TextField
            inputRef={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search everything…"
            fullWidth
            size="small"
            className="app-no-drag"
            InputProps={{
              endAdornment: loading ? <CircularProgress size={16} aria-label="Searching..." /> : null,
            }}
          />
        </Box>
        <Divider />
        <Box sx={{ maxHeight: 420, overflowY: 'auto' }}>
          {results.length === 0 && query && !loading && (
            <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 5 }}>
              No results for "{query}"
            </Typography>
          )}
          {results.length === 0 && !query && (
            <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 5 }}>
              Type to search notes, projects, habits…
            </Typography>
          )}
          {Object.entries(grouped).map(([type, items]) => (
            <Box key={type}>
              <Typography variant="overline" color="text.secondary" sx={{ display: 'block', px: 2, py: 1 }}>
                {TYPE_LABELS[type] ?? type}
              </Typography>
              <List dense disablePadding>
                {items.map((item) => {
                  const globalIdx = results.indexOf(item)
                  return (
                    <ListItemButton
                      key={item.id}
                      selected={globalIdx === selectedIdx}
                      onClick={() => navigateToResult(item)}
                      onMouseEnter={() => setSelectedIdx(globalIdx)}
                      className="app-no-drag"
                    >
                      <ListItemText
                        primary={item.title}
                        secondary={item.snippet}
                        primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
                        secondaryTypographyProps={{ variant: 'caption', noWrap: true }}
                      />
                    </ListItemButton>
                  )
                })}
              </List>
            </Box>
          ))}
        </Box>
        <Stack direction="row" justifyContent="flex-end" sx={{ px: 2, py: 1 }}>
          <Typography variant="caption" color="text.secondary">Esc to close</Typography>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}
