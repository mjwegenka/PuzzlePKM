import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  CalendarDays, Search, FilePlus, Activity, Hash,
  FolderKanban, BookOpen, Settings, FileText, Cloud,
} from 'lucide-react'
import {
  Box,
  Button,
  Divider,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import { useNotesStore } from '../store/notesStore'
import { useUIStore } from '../store/uiStore'
import { getTodayDate, formatDateShort } from '../lib/dateUtils'

export default function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { topicNotes, tags } = useNotesStore()
  const { authState, syncStatus, setSearchOpen, setAuthState, setSyncStatus } = useUIStore()
  const [authLoading, setAuthLoading] = useState(false)
  const [syncLoading, setSyncLoading] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  const today = getTodayDate()
  const recentNotes = topicNotes.slice(0, 15)
  const isActive = (path: string) => location.pathname === path

  return (
    <Paper variant="outlined" square sx={{ width: 256, display: 'flex', flexDirection: 'column', borderTop: 0, borderBottom: 0, borderLeft: 0 }}>
      <Box sx={{ px: 2.5, pt: 2, pb: 1.5 }}>
        <Typography variant="subtitle1" fontWeight={700}>Dropith</Typography>
      </Box>

      <Box sx={{ px: 1.25 }}>
        <SectionLabel>Workspace</SectionLabel>
        <NavButton active={isActive(`/daily/${today}`)} onClick={() => navigate(`/daily/${today}`)} icon={<CalendarDays size={16} />}>Today</NavButton>
        <NavButton onClick={() => setSearchOpen(true)} icon={<Search size={16} />}>
          Search
          <Typography component="kbd" variant="caption" color="text.secondary" sx={{ ml: 'auto', fontFamily: 'monospace' }}>⌘K</Typography>
        </NavButton>
        <NavButton onClick={() => navigate('/topic/new')} icon={<FilePlus size={16} />}>
          New Note
          <Typography component="kbd" variant="caption" color="text.secondary" sx={{ ml: 'auto', fontFamily: 'monospace' }}>⌘N</Typography>
        </NavButton>
        <NavButton active={isActive('/habits')} onClick={() => navigate('/habits')} icon={<Activity size={16} />}>Habits</NavButton>
        <NavButton active={isActive('/tags')} onClick={() => navigate('/tags')} icon={<Hash size={16} />}>Tags</NavButton>

        <Box sx={{ pt: 1.5 }}>
          <SectionLabel>Dropbox</SectionLabel>
        </Box>
        <NavButton active={isActive('/projects')} onClick={() => navigate('/projects')} icon={<FolderKanban size={16} />}>Projects</NavButton>
        <NavButton active={isActive('/references')} onClick={() => navigate('/references')} icon={<BookOpen size={16} />}>References</NavButton>
        <NavButton active={isActive('/settings')} onClick={() => navigate('/settings')} icon={<Settings size={16} />}>Settings</NavButton>
      </Box>

      <Divider sx={{ my: 1.5, mx: 1.5 }} />

      <Box sx={{ flex: 1, overflowY: 'auto', px: 1.25, pb: 1 }}>
        <SectionLabel>Notes</SectionLabel>
        <List dense disablePadding sx={{ mb: 1 }}>
          {recentNotes.map((note) => (
            <ListItemButton
              key={note.id}
              selected={isActive(`/topic/${note.id}`)}
              onClick={() => navigate(`/topic/${note.id}`)}
              className="app-no-drag"
              sx={{ borderRadius: 1, mb: 0.25 }}
            >
              <ListItemIcon sx={{ minWidth: 30 }}><FileText size={15} /></ListItemIcon>
              <ListItemText primaryTypographyProps={{ variant: 'body2', noWrap: true }} primary={note.title || 'Untitled'} />
            </ListItemButton>
          ))}
          {recentNotes.length === 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ px: 1.5 }}>No notes yet</Typography>
          )}
        </List>

        {tags.length > 0 && (
          <>
            <SectionLabel>Tags</SectionLabel>
            <List dense disablePadding>
              {tags.slice(0, 20).map((tag) => (
                <ListItemButton key={tag.id} onClick={() => navigate(`/tags?focus=${tag.id}`)} className="app-no-drag" sx={{ borderRadius: 1, mb: 0.25 }}>
                  <ListItemIcon sx={{ minWidth: 30 }}><Hash size={14} /></ListItemIcon>
                  <ListItemText primaryTypographyProps={{ variant: 'body2', noWrap: true }} primary={tag.displayName} />
                </ListItemButton>
              ))}
            </List>
          </>
        )}
      </Box>

      <Box sx={{ p: 1.5, borderTop: 1, borderColor: 'divider' }}>
        <Stack spacing={1}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Box sx={{ color: authState.isConnected ? 'success.main' : 'text.secondary', display: 'flex' }}>
              <Cloud size={13} />
            </Box>
            <Typography variant="caption" color="text.secondary" noWrap>
              {authState.isConnected ? authState.accountEmail ?? 'Dropbox connected' : 'Dropbox not connected'}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1}>
            <Button
              className="app-no-drag"
              variant="outlined"
              size="small"
              onClick={async () => {
                setAuthLoading(true)
                setAuthError(null)
                try {
                  const result = authState.isConnected
                    ? await window.dropith.auth.disconnect()
                    : await window.dropith.auth.connect()
                  if (!result.success) {
                    setAuthError(result.error ?? 'Connection failed')
                  } else {
                    const auth = await window.dropith.auth.getState()
                    if (auth.success && auth.data) setAuthState(auth.data)
                  }
                } finally {
                  setAuthLoading(false)
                }
              }}
              disabled={authLoading}
            >
              {authLoading ? 'Working…' : authState.isConnected ? 'Disconnect' : 'Connect'}
            </Button>
            <Button
              className="app-no-drag"
              variant="outlined"
              size="small"
              onClick={async () => {
                setSyncLoading(true)
                try {
                  const status = await window.dropith.sync.trigger()
                  if (status.success && status.data) setSyncStatus(status.data)
                } finally {
                  setSyncLoading(false)
                }
              }}
              disabled={syncLoading}
            >
              {syncLoading ? 'Syncing…' : 'Sync now'}
            </Button>
          </Stack>
          {authError && <Typography variant="caption" color="error">{authError}</Typography>}
          {syncStatus.isSyncing && <Typography variant="caption" color="info.main">Syncing…</Typography>}
          {syncStatus.error && <Typography variant="caption" color="error">{syncStatus.error}</Typography>}
          {syncStatus.lastSyncAt && !syncStatus.isSyncing && (
            <Typography variant="caption" color="text.secondary">
              Synced {formatDateShort(syncStatus.lastSyncAt.split('T')[0])}
            </Typography>
          )}
        </Stack>
      </Box>
    </Paper>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="caption" color="text.secondary" sx={{ px: 1.5, pb: 0.5, display: 'block', textTransform: 'uppercase', letterSpacing: 0.5 }}>
      {children}
    </Typography>
  )
}

interface NavButtonProps {
  active?: boolean
  onClick: () => void
  icon?: React.ReactNode
  children: React.ReactNode
}

function NavButton({ active, onClick, icon, children }: NavButtonProps) {
  return (
    <ListItemButton selected={active} onClick={onClick} className="app-no-drag" sx={{ borderRadius: 1, mb: 0.25 }}>
      {icon && <ListItemIcon sx={{ minWidth: 30 }}>{icon}</ListItemIcon>}
      <ListItemText primaryTypographyProps={{ variant: 'body2' }} primary={children} />
    </ListItemButton>
  )
}
