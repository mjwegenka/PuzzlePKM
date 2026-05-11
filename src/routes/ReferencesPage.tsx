import { useEffect, useMemo, useState } from 'react'
import { Box, List, ListItemButton, ListItemText, Paper, Stack, Typography } from '@mui/material'
import { useSearchParams } from 'react-router-dom'
import type { ReferenceMaterial } from '../shared/types'
import { Button } from '../components/ui/button'
import { Trash2 } from 'lucide-react'

export default function ReferencesPage() {
  const [searchParams] = useSearchParams()
  const [items, setItems] = useState<ReferenceMaterial[]>([])
  const [selectedId, setSelectedId] = useState('')

  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId])

  useEffect(() => {
    const load = async () => {
      const res = await window.dropith.refMat.list()
      if (!res.success || !res.data) return
      setItems(res.data)
      const focusId = searchParams.get('focus')
      const initial = focusId && res.data.some((item) => item.id === focusId) ? focusId : res.data[0]?.id ?? ''
      setSelectedId(initial)
    }
    load()
  }, [searchParams])

  const createRef = async () => {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const res = await window.dropith.refMat.create({
      id,
      name: 'New Reference',
      dropboxPath: '',
      tags: [],
      createdAt: now,
      updatedAt: now,
    })
    if (!res.success || !res.data) return
    const created = res.data
    setItems((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
    setSelectedId(id)
  }

  const deleteRef = async (id: string) => {
    if (!window.confirm('Delete this reference material?')) return
    await window.dropith.refMat.delete(id)
    setItems((prev) => {
      const next = prev.filter((item) => item.id !== id)
      setSelectedId(next[0]?.id ?? '')
      return next
    })
  }

  return (
    <Box sx={{ height: '100%', display: 'grid', gridTemplateColumns: '280px 1fr' }}>
      <Paper variant="outlined" square sx={{ borderTop: 0, borderBottom: 0, borderLeft: 0, p: 1.5, overflowY: 'auto' }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="subtitle2" fontWeight={700}>Reference Materials</Typography>
          <Button size="sm" onClick={createRef}>New</Button>
        </Stack>
        <List dense disablePadding>
          {items.map((item) => (
            <Stack key={item.id} direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.25 }}>
              <ListItemButton
                className="app-no-drag"
                selected={item.id === selectedId}
                sx={{ borderRadius: 1 }}
                onClick={() => setSelectedId(item.id)}
              >
                <ListItemText primaryTypographyProps={{ variant: 'body2' }} primary={item.name} />
              </ListItemButton>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => deleteRef(item.id)}
                title="Delete reference"
                aria-label={`Delete reference ${item.name}`}
              >
                <Trash2 size={12} />
              </Button>
            </Stack>
          ))}
        </List>
      </Paper>
      <Box sx={{ p: 2.5, overflowY: 'auto' }}>
        {selected ? (
          <Stack spacing={1.5}>
            <Typography variant="h5" fontWeight={700}>{selected.name}</Typography>
            <Typography variant="body2" color="text.secondary">Dropbox path: {selected.dropboxPath || '(not set)'}</Typography>
            {selected.dropboxPath && (
              <Button onClick={() => void window.dropith.refMat.openPath(selected.dropboxPath, 'folder')}>
                Open in Dropbox
              </Button>
            )}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">Create or select a reference material item.</Typography>
        )}
      </Box>
    </Box>
  )
}
