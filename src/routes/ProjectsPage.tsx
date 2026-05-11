import { useEffect, useMemo, useState } from 'react'
import { Box, List, ListItemButton, ListItemText, Paper, Stack, Typography } from '@mui/material'
import { useSearchParams } from 'react-router-dom'
import type { DropboxEntry, Project } from '../shared/types'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Trash2 } from 'lucide-react'

export default function ProjectsPage() {
  const [searchParams] = useSearchParams()
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [browsePath, setBrowsePath] = useState('')
  const [entries, setEntries] = useState<DropboxEntry[]>([])
  const [status, setStatus] = useState('')

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedId) ?? null,
    [projects, selectedId],
  )

  useEffect(() => {
    const load = async () => {
      const res = await window.dropith.project.list()
      if (!res.success || !res.data) return
      setProjects(res.data)
      const focusId = searchParams.get('focus')
      const initial = focusId && res.data.some((p) => p.id === focusId) ? focusId : res.data[0]?.id ?? ''
      setSelectedId(initial)
      setBrowsePath(res.data.find((p) => p.id === initial)?.dropboxPath ?? '')
    }
    load()
  }, [searchParams])

  const browse = async (path = browsePath) => {
    setStatus('Browsing Dropbox…')
    const res = await window.dropith.project.browse(path)
    if (res.success && res.data) {
      setEntries(res.data)
      setBrowsePath(path)
      setStatus('')
      return
    }
    setStatus(res.error ?? 'Failed to browse Dropbox')
  }

  const createProject = async () => {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const res = await window.dropith.project.create({
      id,
      name: 'New Project',
      dropboxPath: '',
      tags: [],
      createdAt: now,
      updatedAt: now,
    })
    if (!res.success || !res.data) return
    const created = res.data
    setProjects((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
    setSelectedId(id)
    setStatus('Created new project')
  }

  const deleteProject = async (id: string) => {
    if (!window.confirm('Delete this project?')) return
    await window.dropith.project.delete(id)
    setProjects((prev) => {
      const next = prev.filter((p) => p.id !== id)
      setSelectedId(next[0]?.id ?? '')
      return next
    })
  }

  return (
    <Box sx={{ height: '100%', display: 'grid', gridTemplateColumns: '280px 1fr' }}>
      <Paper variant="outlined" square sx={{ borderTop: 0, borderBottom: 0, borderLeft: 0, p: 1.5, overflowY: 'auto' }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="subtitle2" fontWeight={700}>Projects</Typography>
          <Button size="sm" onClick={createProject}>New</Button>
        </Stack>
        <List dense disablePadding>
          {projects.map((project) => (
            <Stack key={project.id} direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.25 }}>
              <ListItemButton
                className="app-no-drag"
                selected={project.id === selectedId}
                sx={{ borderRadius: 1 }}
                onClick={() => {
                  setSelectedId(project.id)
                  setBrowsePath(project.dropboxPath)
                }}
              >
                <ListItemText primaryTypographyProps={{ variant: 'body2' }} primary={project.name} />
              </ListItemButton>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => deleteProject(project.id)}
                title="Delete project"
                aria-label={`Delete project ${project.name}`}
              >
                <Trash2 size={12} />
              </Button>
            </Stack>
          ))}
        </List>
      </Paper>
      <Box sx={{ p: 2.5, overflowY: 'auto' }}>
        {selectedProject ? (
          <Stack spacing={2}>
            <Typography variant="h5" fontWeight={700}>{selectedProject.name}</Typography>
            <Stack direction="row" spacing={1}>
              <Input
                value={browsePath}
                onChange={(e) => setBrowsePath(e.target.value)}
                placeholder="/Project Folder"
              />
              <Button onClick={() => browse()}>Browse</Button>
              <Button onClick={() => void window.dropith.project.openPath(browsePath, 'folder')}>
                Open Folder
              </Button>
            </Stack>
            {status && <Typography variant="caption" color="text.secondary">{status}</Typography>}
            <List disablePadding>
              {entries.map((entry) => (
                <ListItemButton
                  key={entry.path}
                  className="app-no-drag"
                  sx={{ borderRadius: 1, mb: 0.5, border: 1, borderColor: 'divider' }}
                  onClick={() => {
                    if (entry.type === 'folder') void browse(entry.path)
                    else void window.dropith.project.openPath(entry.path, 'file')
                  }}
                >
                  <ListItemText
                    primary={`${entry.type === 'folder' ? '📁' : '📄'} ${entry.name}`}
                    secondary={entry.type}
                    primaryTypographyProps={{ variant: 'body2' }}
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                </ListItemButton>
              ))}
            </List>
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">Create or select a project.</Typography>
        )}
      </Box>
    </Box>
  )
}
