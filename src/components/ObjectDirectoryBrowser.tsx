import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  CircularProgress,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import FolderIcon from '@mui/icons-material/Folder'
import DescriptionIcon from '@mui/icons-material/Description'
import { browseDirectory, openPathInDefaultApp } from '../lib/cliService'

type FileObjectType = 'project' | 'ref-material'

interface ObjectDirectoryBrowserProps {
  type: FileObjectType
  object?: Record<string, unknown>
}

function joinPath(base: string, child: string): string {
  if (!base) return child
  return `${base.replace(/\/$/, '')}/${child.replace(/^\//, '')}`
}

export default function ObjectDirectoryBrowser({ type, object }: ObjectDirectoryBrowserProps) {
  const syncPath = String((object?.syncPath ?? object?.dropboxPath ?? '') as string).trim()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [directoryPath, setDirectoryPath] = useState('')
  const [entries, setEntries] = useState<Array<{ kind: 'dir' | 'file'; name: string }>>([])

  const title = useMemo(() => (type === 'project' ? 'Project files' : 'Reference files'), [type])

  const load = useCallback(async () => {
    if (!syncPath) {
      setEntries([])
      setDirectoryPath('')
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const result = await browseDirectory(syncPath)
      setDirectoryPath(result.directoryPath)
      setEntries(result.entries)
    } catch (err) {
      const message = String(err)
      const missingPathMatch = /Path not found:\s*(.+)$/i.exec(message)
      if (missingPathMatch?.[1]) {
        setDirectoryPath(missingPathMatch[1].trim())
        setEntries([])
        setError(null)
        return
      }
      setEntries([])
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [syncPath])

  useEffect(() => {
    void load()
  }, [load])

  const handleOpenEntry = useCallback(
    async (entry: { kind: 'dir' | 'file'; name: string }) => {
      if (!directoryPath) return
      const absolutePath = joinPath(directoryPath, entry.name)
      try {
        await openPathInDefaultApp(absolutePath)
      } catch (err) {
        setError(String(err))
      }
    },
    [directoryPath],
  )

  return (
    <Paper sx={{ mt: 1.5, p: 1.25, bgcolor: '#0e2038', border: '1px solid #1c3558', minHeight: 180, display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="caption" sx={{ color: '#7dbad6', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 700 }}>
          {title}
        </Typography>
        <IconButton size="small" onClick={() => void load()} sx={{ color: '#7dbad6' }}>
          <RefreshIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Stack>

      {directoryPath && (
        <Typography variant="caption" sx={{ color: '#4a6a8a', mb: 1, wordBreak: 'break-all' }}>
          {directoryPath}
        </Typography>
      )}

      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}

      {loading ? (
        <Box sx={{ py: 2, display: 'flex', justifyContent: 'center' }}>
          <CircularProgress size={18} />
        </Box>
      ) : entries.length === 0 ? (
        <Typography variant="caption" sx={{ color: '#4a6a8a', fontStyle: 'italic' }}>
          No files found.
        </Typography>
      ) : (
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <List dense disablePadding>
            {entries.map((entry) => (
              <ListItemButton
                key={`${entry.kind}:${entry.name}`}
                onClick={() => void handleOpenEntry(entry)}
                sx={{ borderRadius: 1, mb: 0.25 }}
              >
                {entry.kind === 'dir'
                  ? <FolderIcon sx={{ fontSize: 15, color: '#c8832a', mr: 1 }} />
                  : <DescriptionIcon sx={{ fontSize: 15, color: '#7dbad6', mr: 1 }} />}
                <ListItemText
                  primary={entry.name}
                  slotProps={{
                    primary: {
                      sx: { color: '#e4f0fb', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                    },
                  }}
                />
              </ListItemButton>
            ))}
          </List>
        </Box>
      )}
    </Paper>
  )
}

