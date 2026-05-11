import { useEffect, useState, Component, ReactNode } from 'react'
import { Box, Paper, Typography } from '@mui/material'
import { Navigate, Route, Routes } from 'react-router-dom'
import SidebarLayout from './routes/SidebarLayout'
import TopicNotePage from './routes/TopicNotePage'
import DailyNotePage from './routes/DailyNotePage'
import ProjectsPage from './routes/ProjectsPage'
import ReferencesPage from './routes/ReferencesPage'
import HabitsPage from './routes/HabitsPage'
import TagsPage from './routes/TagsPage'
import SettingsPage from './routes/SettingsPage'
import { useNotesStore } from './store/notesStore'
import { useUIStore } from './store/uiStore'
import { getTodayDate } from './lib/dateUtils'

function App() {
  const { setTopicNotes, setTags } = useNotesStore()
  const { setAuthState, setSyncStatus, setSearchOpen } = useUIStore()
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    // Load initial data
    const init = async () => {
      // Wait for the IPC bridge to be available (with timeout)
      let retries = 0;
      while (typeof window.dropith === 'undefined' && retries < 50) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        retries++;
      }

      if (typeof window.dropith === 'undefined') {
        console.error('[App] IPC bridge never became available');
        return;
      }

      const [notesRes, tagsRes, authRes, syncRes] = await Promise.all([
        window.dropith.topicNote.list(),
        window.dropith.tag.list(),
        window.dropith.auth.getState(),
        window.dropith.sync.getStatus(),
      ])
      if (notesRes.success && notesRes.data) setTopicNotes(notesRes.data)
      if (tagsRes.success && tagsRes.data) setTags(tagsRes.data)
      if (authRes.success && authRes.data) setAuthState(authRes.data)
      if (syncRes.success && syncRes.data) setSyncStatus(syncRes.data)
      setIsReady(true)
    }
    init()
    .catch((err) => {
      console.error('[App] Initialization failed:', err);
      setIsReady(true) // Show UI even if init fails, so errors are visible
    });

    // Listen for sync status changes (only if IPC is available)
    if (typeof window.dropith !== 'undefined') {
      const offSync = window.dropith.sync.onStatusChanged(setSyncStatus)

      // Global keyboard shortcuts
      const offSearch = window.dropith.onMenuEvent('menu:quick-search', () => setSearchOpen(true))
      const offSearchFull = window.dropith.onMenuEvent('menu:search', () => setSearchOpen(true))

      // Native keyboard shortcut fallback
      const handleKeyDown = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
          e.preventDefault()
          setSearchOpen(true)
        }
      }
      window.addEventListener('keydown', handleKeyDown)

      return () => {
        offSync()
        offSearch()
        offSearchFull()
        window.removeEventListener('keydown', handleKeyDown)
      }
    }
  }, [setAuthState, setSearchOpen, setSyncStatus, setTags, setTopicNotes])

  if (!isReady) {
    return (
      <Box sx={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
        <Paper variant="outlined" sx={{ px: 4, py: 3, textAlign: 'center' }}>
          <Typography variant="h5" fontWeight={700} gutterBottom>Dropith</Typography>
          <Typography variant="body2" color="text.secondary">Loading…</Typography>
        </Paper>
      </Box>
    )
  }

  return (
    <Routes>
      <Route element={<SidebarLayout />}>
        <Route index element={<Navigate to={`/daily/${getTodayDate()}`} replace />} />
        <Route path="/daily/:date" element={<DailyNotePage />} />
        <Route path="/topic/:id" element={<TopicNotePage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/references" element={<ReferencesPage />} />
        <Route path="/habits" element={<HabitsPage />} />
        <Route path="/tags" element={<TagsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}

// Error boundary for debugging
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Render error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box sx={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', p: 3 }}>
          <Paper variant="outlined" sx={{ p: 3, maxWidth: 640, width: '100%' }}>
            <Typography variant="h6" fontWeight={700} gutterBottom>App Error</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {this.state.error?.message || 'An unexpected error occurred'}
            </Typography>
            <Box component="pre" sx={{ fontSize: 12, bgcolor: 'background.default', p: 1.5, borderRadius: 1, overflow: 'auto', maxHeight: 180, textAlign: 'left' }}>
              {this.state.error?.stack}
            </Box>
          </Paper>
        </Box>
      )
    }

    return this.props.children
  }
}

export default function AppWrapper() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  )
}
