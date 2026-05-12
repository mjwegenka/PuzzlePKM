import React, { useState, useEffect, useCallback } from 'react'
import {
  Box,
  Stack,
  Paper,
  Typography,
  Chip,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Divider,
  CircularProgress,
  TextField,
  IconButton,
  Tooltip,
} from '@mui/material'
import LabelIcon from '@mui/icons-material/Label'
import RefreshIcon from '@mui/icons-material/Refresh'
import ClearIcon from '@mui/icons-material/Clear'
import ObjectEditor from './ObjectEditor'
import { listDailyNoteMeta, listTopicNoteMeta, listHabitMeta, getObject } from '../lib/cliService'

type NoteType = 'daily-note' | 'topic-note' | 'habit'

interface TaggedItem {
  id: string
  type: NoteType
  title: string
  tags: string[]
  date?: string
}

export default function TagsPage() {
  const [items, setItems] = useState<TaggedItem[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [tagFilter, setTagFilter] = useState('')
  const [selectedObject, setSelectedObject] = useState<Record<string, unknown> | undefined>()
  const [selectedType, setSelectedType] = useState<NoteType>('daily-note')

   const loadAll = useCallback(async () => {
     setLoading(true)
     try {
       const [dailyRes, topicRes, habitRes] = await Promise.allSettled([
         listDailyNoteMeta(),
         listTopicNoteMeta(),
         listHabitMeta(),
       ])
       const collected: TaggedItem[] = []
       if (dailyRes.status === 'fulfilled') {
         for (const n of dailyRes.value) {
           collected.push({ id: n.id, type: 'daily-note', title: n.date, date: n.date, tags: n.tags })
         }
       }
       if (topicRes.status === 'fulfilled') {
         for (const n of topicRes.value) {
           collected.push({ id: n.id, type: 'topic-note', title: n.title, tags: n.tags })
         }
       }
       if (habitRes.status === 'fulfilled') {
         for (const h of habitRes.value) {
           collected.push({ id: h.id, type: 'habit', title: h.text, date: h.date, tags: h.tags })
         }
       }
       setItems(collected)
     } finally {
       setLoading(false)
     }
   }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // ── Aggregate tags ────────────────────────────────────────────────────────
  const tagCounts = new Map<string, number>()
  for (const item of items) {
    for (const tag of item.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
    }
  }
  const sortedTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .filter(([tag]) => !tagFilter || tag.includes(tagFilter.toLowerCase()))

  const filteredItems = selectedTag
    ? items.filter((o) => o.tags.includes(selectedTag))
    : items

  // ── Handlers ──────────────────────────────────────────────────────────────
  const openItem = async (item: TaggedItem) => {
    setSelectedType(item.type)
    try {
      const full = await getObject(item.type, item.id)
      setSelectedObject({ ...full, type: item.type })
    } catch {
      setSelectedObject({ id: item.id, type: item.type, contentMarkdown: '', tags: item.tags })
    }
  }

  const handleSave = useCallback(
    async (saved: Record<string, unknown>) => {
      await loadAll()
      setSelectedObject({ ...saved, type: selectedType })
    },
    [loadAll, selectedType],
  )

  const totalTagged = items.filter((i) => i.tags.length > 0).length

  return (
    <Stack direction="row" spacing={2} sx={{ height: '100%', minHeight: 0 }}>
      {/* ── Left: Tag browser ─────────────────────────────────────────────── */}
      <Stack spacing={1.5} sx={{ width: 280, flexShrink: 0, minHeight: 0 }}>
        {/* Tag cloud */}
        <Paper
          sx={{
            p: 2,
            bgcolor: '#0e2038',
            border: '1px solid #1c3558',
            display: 'flex',
            flexDirection: 'column',
            gap: 1.5,
          }}
        >
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Stack direction="row" spacing={1} alignItems="center">
              <LabelIcon sx={{ fontSize: 16, color: '#1a8ab5' }} />
              <Typography
                variant="caption"
                sx={{
                  fontWeight: 700,
                  color: '#7dbad6',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  fontSize: '10px',
                }}
              >
                Tags ({tagCounts.size})
              </Typography>
            </Stack>
            <Stack direction="row" spacing={0.5} alignItems="center">
              {loading && <CircularProgress size={12} />}
              <Tooltip title="Refresh">
                <IconButton size="small" onClick={loadAll} sx={{ p: 0.3 }}>
                  <RefreshIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            </Stack>
          </Stack>

          {/* Tag filter */}
          <TextField
            size="small"
            placeholder="Filter tags…"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            variant="outlined"
            slotProps={{
              input: {
                endAdornment: tagFilter ? (
                  <IconButton size="small" onClick={() => setTagFilter('')} sx={{ p: 0.2 }}>
                    <ClearIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                ) : null,
              },
            }}
            sx={{ '& .MuiOutlinedInput-root': { fontSize: '13px' } }}
          />

          {/* Chips */}
          <Box sx={{ maxHeight: 220, overflow: 'auto' }}>
            {tagCounts.size === 0 && !loading && (
              <Typography variant="caption" sx={{ color: '#4a6a8a' }}>
                No tags found across your notes.
              </Typography>
            )}
            <Stack direction="row" flexWrap="wrap" gap={0.75} useFlexGap>
              {selectedTag && (
                <Chip
                  label="× Show all"
                  size="small"
                  onClick={() => setSelectedTag(null)}
                  sx={{
                    bgcolor: 'rgba(255,255,255,0.06)',
                    border: '1px solid #1c3558',
                    color: '#7dbad6',
                    height: 22,
                    fontSize: '11px',
                    cursor: 'pointer',
                  }}
                />
              )}
              {sortedTags.map(([tag, count]) => (
                <Chip
                  key={tag}
                  label={`#${tag} ${count}`}
                  size="small"
                  onClick={() => setSelectedTag(tag === selectedTag ? null : tag)}
                  sx={{
                    bgcolor:
                      selectedTag === tag
                        ? 'rgba(26,138,181,0.35)'
                        : 'rgba(26,138,181,0.10)',
                    border: `1px solid ${selectedTag === tag ? '#1a8ab5' : 'rgba(26,138,181,0.28)'}`,
                    color: '#b0d4e8',
                    height: 22,
                    fontSize: '11px',
                    cursor: 'pointer',
                    '&:hover': { filter: 'brightness(1.2)' },
                  }}
                />
              ))}
            </Stack>
          </Box>

          {/* Stats */}
          <Typography variant="caption" sx={{ color: '#4a6a8a', pt: 0.5 }}>
            {totalTagged} of {items.length} objects have tags
          </Typography>
        </Paper>

        {/* Object list */}
        <Paper
          sx={{
            flex: 1,
            p: 0,
            bgcolor: '#0e2038',
            border: '1px solid #1c3558',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            minHeight: 0,
          }}
        >
          <Box sx={{ px: 2, py: 1.25, borderBottom: '1px solid #1c3558', flexShrink: 0 }}>
            <Typography
              variant="caption"
              sx={{
                fontWeight: 700,
                color: selectedTag ? '#b0d4e8' : '#7dbad6',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                fontSize: '10px',
              }}
            >
              {selectedTag ? `#${selectedTag} — ${filteredItems.length} objects` : `All objects (${items.length})`}
            </Typography>
          </Box>
          <List dense sx={{ p: 0, flex: 1, overflow: 'auto' }}>
            {filteredItems.length === 0 ? (
              <Typography
                variant="caption"
                sx={{ color: '#4a6a8a', display: 'block', textAlign: 'center', py: 3 }}
              >
                {selectedTag ? `No objects tagged #${selectedTag}` : 'No objects'}
              </Typography>
            ) : (
              filteredItems.map((item, idx) => (
                <Box key={item.id}>
                  <ListItem disablePadding>
                    <ListItemButton
                      selected={selectedObject?.id === item.id}
                      onClick={() => openItem(item)}
                      sx={{
                        py: 0.85,
                        px: 1.5,
                        '&.Mui-selected': { bgcolor: 'rgba(26,138,181,0.15)' },
                      }}
                    >
                      <ListItemText
                        primary={
                          <Typography
                            variant="body2"
                            sx={{ fontWeight: 500, fontSize: '13px', lineHeight: 1.3 }}
                          >
                            {item.title}
                          </Typography>
                        }
                         secondary={
                           <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.3 }}>
                             <Typography
                               variant="caption"
                               sx={{
                                 color:
                                   item.type === 'topic-note' ? '#7dcfaa' : item.type === 'habit' ? '#e8a84a' : '#7dbad6',
                                 fontSize: '10px',
                               }}
                             >
                               {item.type === 'daily-note' ? '📓 Daily Note' : item.type === 'habit' ? '🔁 Habit' : '📝 Topic Note'}
                             </Typography>
                            {item.tags.slice(0, 2).map((t) => (
                              <Typography
                                key={t}
                                variant="caption"
                                sx={{
                                  bgcolor: 'rgba(26,138,181,0.18)',
                                  px: 0.5,
                                  borderRadius: '3px',
                                  fontSize: '9px',
                                  color: '#7dbad6',
                                }}
                              >
                                #{t}
                              </Typography>
                            ))}
                            {item.tags.length > 2 && (
                              <Typography variant="caption" sx={{ color: '#4a6a8a', fontSize: '10px' }}>
                                +{item.tags.length - 2}
                              </Typography>
                            )}
                          </Stack>
                        }
                      />
                    </ListItemButton>
                  </ListItem>
                  {idx < filteredItems.length - 1 && <Divider sx={{ borderColor: '#1c3558' }} />}
                </Box>
              ))
            )}
          </List>
        </Paper>
      </Stack>

      {/* ── Right: Editor ──────────────────────────────────────────────────── */}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {selectedObject ? (
          <ObjectEditor object={selectedObject} type={selectedType} onSave={handleSave} />
        ) : (
          <Box
            sx={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px dashed #1c3558',
              borderRadius: '8px',
              p: 4,
              gap: 2,
            }}
          >
            <LabelIcon sx={{ fontSize: 44, opacity: 0.25, color: '#1a8ab5' }} />
            <Typography variant="body2" sx={{ color: '#4a6a8a', textAlign: 'center' }}>
              {selectedTag
                ? `Select an object tagged #${selectedTag} to edit it`
                : 'Select a tag to filter, then click an object to edit'}
            </Typography>
          </Box>
        )}
      </Box>
    </Stack>
  )
}

