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
import ImageIcon from '@mui/icons-material/Image'
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf'
import TerminalIcon from '@mui/icons-material/Terminal'
import TableChartIcon from '@mui/icons-material/TableChart'
import SlideshowIcon from '@mui/icons-material/Slideshow'
import MovieIcon from '@mui/icons-material/Movie'
import AudioFileIcon from '@mui/icons-material/AudioFile'
import ArchiveIcon from '@mui/icons-material/Archive'
import { browseDirectory, openPathInDefaultApp } from '../lib/cliService'

type FileObjectType = 'project' | 'ref-material'

interface ObjectDirectoryBrowserProps {
  type: FileObjectType
  object?: Record<string, unknown>
  embedded?: boolean
}

function joinPath(base: string, child: string): string {
  if (!base) return child
  return `${base.replace(/\/$/, '')}/${child.replace(/^\//, '')}`
}

function fileIconForName(name: string): React.ReactNode {
  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() ?? '' : ''
  const iconProps = { sx: { fontSize: 15, mr: 1 } }

  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic', 'bmp'].includes(ext)) {
    return <ImageIcon {...iconProps} sx={{ ...iconProps.sx, color: 'success.main' }} />
  }
  if (ext === 'pdf') {
    return <PictureAsPdfIcon {...iconProps} sx={{ ...iconProps.sx, color: 'error.main' }} />
  }
  if (['md', 'txt', 'rtf'].includes(ext)) {
    return <DescriptionIcon {...iconProps} sx={{ ...iconProps.sx, color: 'info.main' }} />
  }
  if (['csv', 'tsv', 'xls', 'xlsx', 'numbers'].includes(ext)) {
    return <TableChartIcon {...iconProps} sx={{ ...iconProps.sx, color: 'success.main' }} />
  }
  if (['ppt', 'pptx', 'key'].includes(ext)) {
    return <SlideshowIcon {...iconProps} sx={{ ...iconProps.sx, color: 'warning.main' }} />
  }
  if (['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm'].includes(ext)) {
    return <MovieIcon {...iconProps} sx={{ ...iconProps.sx, color: 'secondary.main' }} />
  }
  if (['mp3', 'wav', 'm4a', 'aac', 'flac'].includes(ext)) {
    return <AudioFileIcon {...iconProps} sx={{ ...iconProps.sx, color: 'secondary.main' }} />
  }
  if (['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z'].includes(ext)) {
    return <ArchiveIcon {...iconProps} sx={{ ...iconProps.sx, color: 'warning.main' }} />
  }
  if (['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'json', 'yml', 'yaml', 'toml', 'ini', 'xml', 'html', 'css', 'scss', 'rs', 'swift', 'py', 'sh', 'zsh'].includes(ext)) {
    return <TerminalIcon {...iconProps} sx={{ ...iconProps.sx, color: 'accent.metadata' }} />
  }

  return <DescriptionIcon sx={{ fontSize: 15, color: 'text.secondary', mr: 1 }} />
}

export default function ObjectDirectoryBrowser({ type, object, embedded = false }: ObjectDirectoryBrowserProps) {
  const syncPath = String((object?.syncPath ?? object?.syncPath ?? '') as string).trim()
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
    <Paper
      elevation={0}
      sx={{
        mt: embedded ? 0 : 1.5,
        p: embedded ? 0 : 1.25,
        bgcolor: 'surface.elevated',
        border: embedded ? 'none' : type === 'project' ? 'none' : '1px solid',
        borderColor: 'border.subtle',
        borderRadius: embedded ? 0 : type === 'project' ? 0 : undefined,
        minHeight: 180,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 700 }}>
          {title}
        </Typography>
        <IconButton size="small" onClick={() => void load()} sx={{ color: 'text.secondary' }}>
          <RefreshIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Stack>

      {directoryPath && (
        <Typography variant="caption" sx={{ color: 'text.disabled', mb: 1, wordBreak: 'break-all' }}>
          {directoryPath}
        </Typography>
      )}

      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}

      {loading ? (
        <Box sx={{ py: 2, display: 'flex', justifyContent: 'center' }}>
          <CircularProgress size={18} />
        </Box>
      ) : entries.length === 0 ? (
        <Typography variant="caption" sx={{ color: 'text.disabled', fontStyle: 'italic' }}>
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
                  ? <FolderIcon sx={{ fontSize: 15, color: 'warning.main', mr: 1 }} />
                  : fileIconForName(entry.name)}
                <ListItemText
                  primary={entry.name}
                  slotProps={{
                    primary: {
                      sx: { color: 'text.primary', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
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

