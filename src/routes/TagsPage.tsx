import { useEffect, useState } from 'react'
import { Box, List, ListItemButton, ListItemText, Paper, Typography } from '@mui/material'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { Tag, TaggedObjectResult } from '../shared/types'

export default function TagsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [tags, setTags] = useState<Tag[]>([])
  const [selectedTagId, setSelectedTagId] = useState('')
  const [objects, setObjects] = useState<TaggedObjectResult[]>([])

  useEffect(() => {
    const load = async () => {
      const res = await window.dropith.tag.list()
      if (!res.success || !res.data) return
      setTags(res.data)
      const focusId = searchParams.get('focus')
      const initial = focusId && res.data.some((tag) => tag.id === focusId) ? focusId : res.data[0]?.id ?? ''
      setSelectedTagId(initial)
    }
    load()
  }, [searchParams])

  useEffect(() => {
    if (!selectedTagId) {
      setObjects([])
      return
    }
    const loadTaggedObjects = async () => {
      const res = await window.dropith.tag.getObjects(selectedTagId)
      if (res.success && res.data) setObjects(res.data)
    }
    loadTaggedObjects()
  }, [selectedTagId])

  return (
    <Box sx={{ height: '100%', display: 'grid', gridTemplateColumns: '280px 1fr' }}>
      <Paper variant="outlined" square sx={{ borderTop: 0, borderBottom: 0, borderLeft: 0, p: 1.5, overflowY: 'auto' }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Tags</Typography>
        <List dense disablePadding>
          {tags.map((tag) => (
            <ListItemButton
              key={tag.id}
              className="app-no-drag"
              selected={tag.id === selectedTagId}
              sx={{ borderRadius: 1, mb: 0.25 }}
              onClick={() => setSelectedTagId(tag.id)}
            >
              <ListItemText primaryTypographyProps={{ variant: 'body2' }} primary={`#${tag.displayName}`} />
            </ListItemButton>
          ))}
        </List>
      </Paper>
      <Box sx={{ p: 2.5, overflowY: 'auto' }}>
        <Typography variant="h5" fontWeight={700} sx={{ mb: 2 }}>Tagged Objects</Typography>
        <List disablePadding>
          {objects.map((object) => (
            <ListItemButton
              key={`${object.type}:${object.id}`}
              className="app-no-drag"
              sx={{ mb: 1, borderRadius: 1, border: 1, borderColor: 'divider' }}
              onClick={() => navigate(object.route)}
            >
              <ListItemText
                primary={object.title || '(untitled)'}
                secondary={object.type.toUpperCase()}
                primaryTypographyProps={{ variant: 'body2' }}
                secondaryTypographyProps={{ variant: 'caption' }}
              />
            </ListItemButton>
          ))}
          {objects.length === 0 && (
            <Typography variant="body2" color="text.secondary">No objects linked to this tag yet.</Typography>
          )}
        </List>
      </Box>
    </Box>
  )
}
