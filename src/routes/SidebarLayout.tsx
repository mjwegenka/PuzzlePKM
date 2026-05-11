import { AppBar, Box, Toolbar, Typography } from '@mui/material'
import { Outlet } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import SearchModal from '../components/SearchModal'
import { useUIStore } from '../store/uiStore'

export default function SidebarLayout() {
  const { syncStatus } = useUIStore()

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <AppBar position="static" color="transparent" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar variant="dense" className="window-titlebar app-drag" sx={{ minHeight: '40px !important', px: 3, justifyContent: 'space-between' }}>
          <Typography variant="caption" sx={{ letterSpacing: 0.5, fontWeight: 600 }}>Dropith</Typography>
          <Typography variant="caption" className="app-no-drag" aria-live="polite" aria-label={`Sync status: ${syncStatus.isSyncing ? 'Syncing' : 'Ready'}`}>
          {syncStatus.isSyncing ? 'Syncing…' : 'Ready'}
          </Typography>
        </Toolbar>
      </AppBar>
      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar />
        <Box component="main" sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Outlet />
        </Box>
        <SearchModal />
      </Box>
    </Box>
  )
}
