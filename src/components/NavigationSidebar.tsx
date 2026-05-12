import React from 'react';
import {
  Box,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Divider,
  Tooltip,
  IconButton,
  CircularProgress,
} from '@mui/material';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import FolderIcon from '@mui/icons-material/Folder';
import ArticleIcon from '@mui/icons-material/Article';
import TagIcon from '@mui/icons-material/Label';
import SettingsIcon from '@mui/icons-material/Settings';
import SyncIcon from '@mui/icons-material/Sync';
import { useSyncStatus } from '../lib/syncContext';

interface NavigationItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

interface NavigationSidebarProps {
  onNavigate: (section: string) => void;
  currentSection: string;
}

const navItems: NavigationItem[] = [
  { id: 'calendar', label: 'Calendar', icon: <CalendarTodayIcon /> },
  { id: 'files', label: 'Files', icon: <FolderIcon /> },
  { id: 'notes', label: 'Notes', icon: <ArticleIcon /> },
  { id: 'tags', label: 'Tags', icon: <TagIcon /> },
];

function formatLastSynced(date: Date | null): string {
  if (!date) return 'Never synced';
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 5) return 'Synced just now';
  if (diff < 60) return `Synced ${diff}s ago`;
  if (diff < 3600) return `Synced ${Math.floor(diff / 60)}m ago`;
  return `Synced ${Math.floor(diff / 3600)}h ago`;
}

export default function NavigationSidebar({ onNavigate, currentSection }: NavigationSidebarProps) {
  const { syncing, lastSyncedAt, syncError, triggerSync } = useSyncStatus();

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: 240,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: 240,
          boxSizing: 'border-box',
          bgcolor: '#0e2038',
          borderRight: '1px solid #1c3558',
        },
      }}
    >
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
          Dropith
        </Typography>
        <Typography variant="caption" sx={{ color: '#7dbad6' }}>
          Knowledge Management
        </Typography>
      </Box>

      <Divider sx={{ borderColor: '#1c3558' }} />

      <List sx={{ flex: 1, overflow: 'auto' }}>
        {navItems.map((item) => (
          <ListItem key={item.id} disablePadding>
            <ListItemButton
              selected={currentSection === item.id}
              onClick={() => onNavigate(item.id)}
              sx={{
                '&.Mui-selected': {
                  bgcolor: 'rgba(26,138,181,0.2)',
                  borderLeft: '3px solid #1a8ab5',
                  pl: '14px',
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 40, color: 'inherit' }}>
                {item.icon}
              </ListItemIcon>
              <ListItemText primary={item.label} slotProps={{ primary: { variant: 'body2' } }} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>

      <Divider sx={{ borderColor: '#1c3558' }} />

      {/* ── Sync status + button ── */}
      <Box sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Tooltip title={syncError ?? (syncing ? 'Syncing…' : formatLastSynced(lastSyncedAt))} placement="right">
          <span>
            <IconButton
              size="small"
              onClick={triggerSync}
              disabled={syncing}
              sx={{ color: syncError ? '#f87171' : '#7dbad6', '&:hover': { color: '#e4f0fb' } }}
            >
              {syncing
                ? <CircularProgress size={18} sx={{ color: '#7dbad6' }} />
                : <SyncIcon fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              color: syncError ? '#f87171' : '#7dbad6',
              fontSize: '10px',
              lineHeight: 1.3,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {syncing ? 'Syncing…' : syncError ? 'Sync error' : formatLastSynced(lastSyncedAt)}
          </Typography>
        </Box>
      </Box>

      <Divider sx={{ borderColor: '#1c3558' }} />

      <List>
        <ListItem disablePadding>
          <ListItemButton
            selected={currentSection === 'settings'}
            onClick={() => onNavigate('settings')}
            sx={{
              '&.Mui-selected': {
                bgcolor: 'rgba(26,138,181,0.2)',
                borderLeft: '3px solid #1a8ab5',
                pl: '14px',
              },
            }}
          >
            <ListItemIcon sx={{ minWidth: 40 }}>
              <SettingsIcon />
            </ListItemIcon>
            <ListItemText primary="Settings" slotProps={{ primary: { variant: 'body2' } }} />
          </ListItemButton>
        </ListItem>
      </List>
    </Drawer>
  );
}




