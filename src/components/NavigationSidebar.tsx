import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  Collapse,
} from '@mui/material';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import FolderIcon from '@mui/icons-material/Folder';
import ArticleIcon from '@mui/icons-material/Article';
import TagIcon from '@mui/icons-material/Label';
import SettingsIcon from '@mui/icons-material/Settings';
import SyncIcon from '@mui/icons-material/Sync';
import PushPinIcon from '@mui/icons-material/PushPin';
import CloseIcon from '@mui/icons-material/Close';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import DescriptionIcon from '@mui/icons-material/Description';
import RepeatIcon from '@mui/icons-material/Repeat';
import { useSyncStatus } from '../lib/syncContext';
import { formatDatePretty } from '../lib/dateUtils';
import { getObject, listDailyNoteMeta, listFileMeta, listHabitMeta, listTopicNoteMeta, writeObject } from '../lib/cliService';
import { getObjectColor } from '../lib/objectColors';

interface NavigationItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

interface NavigationSidebarProps {
  onNavigate: (section: string) => void;
  currentSection: string;
  onNavigateToPinned: (target: { id: string; type: 'topic-note' | 'daily-note' | 'habit' | 'project' | 'ref-material' }) => void | Promise<void>;
}

type PinnedType = 'topic-note' | 'daily-note' | 'habit' | 'project' | 'ref-material';

interface PinnedNavItem {
  id: string;
  type: PinnedType;
  title: string;
  tags: string[];
}

const PINNED_TAG = 'pinned';
const PINNED_ORDER_STORAGE_KEY = 'dropith:pinned-order:v1';

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

function makePinnedKey(item: { id: string; type: PinnedType }): string {
  return `${item.type}:${item.id}`;
}

function objectIcon(type: PinnedType): React.ReactNode {
  if (type === 'daily-note') return <CalendarTodayIcon fontSize="small" />;
  if (type === 'habit') return <RepeatIcon fontSize="small" />;
  if (type === 'project' || type === 'ref-material') return <FolderIcon fontSize="small" />;
  return <DescriptionIcon fontSize="small" />;
}

export default function NavigationSidebar({ onNavigate, currentSection, onNavigateToPinned }: NavigationSidebarProps) {
  const { syncing, lastSyncedAt, syncError, triggerSync } = useSyncStatus();
  const [pinnedItems, setPinnedItems] = useState<PinnedNavItem[]>([]);
  const [loadingPinned, setLoadingPinned] = useState(false);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);

  const readPinnedOrder = useCallback((): string[] => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(PINNED_ORDER_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }, []);

  const persistPinnedOrder = useCallback((items: PinnedNavItem[]) => {
    if (typeof window === 'undefined') return;
    const order = items.map((item) => makePinnedKey(item));
    window.localStorage.setItem(PINNED_ORDER_STORAGE_KEY, JSON.stringify(order));
  }, []);

  const orderPinnedItems = useCallback((items: PinnedNavItem[]): PinnedNavItem[] => {
    const existingMap = new Map(items.map((item) => [makePinnedKey(item), item]));
    const storedOrder = readPinnedOrder();
    const used = new Set<string>();
    const ordered: PinnedNavItem[] = [];
    for (const key of storedOrder) {
      const item = existingMap.get(key);
      if (!item) continue;
      ordered.push(item);
      used.add(key);
    }
    const leftovers = items
      .filter((item) => !used.has(makePinnedKey(item)))
      .sort((a, b) => a.title.localeCompare(b.title));
    return [...ordered, ...leftovers];
  }, [readPinnedOrder]);

  const loadPinnedItems = useCallback(async () => {
    setLoadingPinned(true);
    try {
      const [topicNotes, dailyNotes, habits, files] = await Promise.all([
        listTopicNoteMeta(),
        listDailyNoteMeta(),
        listHabitMeta(),
        listFileMeta(),
      ]);
      const combined: PinnedNavItem[] = [
        ...topicNotes.map((item) => ({
          id: item.id,
          type: 'topic-note' as const,
          title: item.title || '(untitled topic)',
          tags: item.tags ?? [],
        })),
        ...dailyNotes.map((item) => ({
          id: item.id,
          type: 'daily-note' as const,
          title: formatDatePretty(item.date),
          tags: item.tags ?? [],
        })),
        ...habits.map((item) => ({
          id: item.id,
          type: 'habit' as const,
          title: item.text || formatDatePretty(item.date),
          tags: item.tags ?? [],
        })),
        ...files.map((item) => ({
          id: item.id,
          type: item.type,
          title: item.name || '(untitled file)',
          tags: item.tags ?? [],
        })),
      ];
      const pinned = combined.filter((item) => item.tags.some((tag) => tag.toLowerCase() === PINNED_TAG));
      setPinnedItems(orderPinnedItems(pinned));
    } finally {
      setLoadingPinned(false);
    }
  }, [orderPinnedItems]);

  useEffect(() => {
    void loadPinnedItems();
  }, [loadPinnedItems]);

  useEffect(() => {
    const handleObjectsUpdated = () => {
      void loadPinnedItems();
    };
    window.addEventListener('dropith:objects-updated', handleObjectsUpdated);
    return () => window.removeEventListener('dropith:objects-updated', handleObjectsUpdated);
  }, [loadPinnedItems]);

  const movePinned = useCallback((sourceIdx: number, targetIdx: number) => {
    setPinnedItems((prev) => {
      if (sourceIdx === targetIdx || sourceIdx < 0 || targetIdx < 0 || sourceIdx >= prev.length || targetIdx >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(sourceIdx, 1);
      next.splice(targetIdx, 0, moved);
      persistPinnedOrder(next);
      return next;
    });
  }, [persistPinnedOrder]);

  const keyToIndex = useMemo(() => {
    const map = new Map<string, number>();
    pinnedItems.forEach((item, idx) => map.set(makePinnedKey(item), idx));
    return map;
  }, [pinnedItems]);

  const handleUnpin = useCallback(async (item: PinnedNavItem) => {
    const current = await getObject(item.type, item.id);
    const tags = Array.isArray((current as { tags?: unknown }).tags)
      ? ((current as { tags: string[] }).tags ?? [])
      : [];
    const nextTags = tags.filter((tag) => tag.toLowerCase() !== PINNED_TAG);
    await writeObject(item.type, { ...current, tags: nextTags });
    setPinnedItems((prev) => {
      const next = prev.filter((entry) => !(entry.id === item.id && entry.type === item.type));
      persistPinnedOrder(next);
      return next;
    });
    window.dispatchEvent(new Event('dropith:objects-updated'));
  }, [persistPinnedOrder]);

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
        <Collapse in timeout="auto" unmountOnExit={false}>
          <Divider sx={{ borderColor: '#1c3558', my: 0.5 }} />
          <StackedPinnedHeader loadingPinned={loadingPinned} count={pinnedItems.length} />
          {pinnedItems.map((item) => {
            const itemKey = makePinnedKey(item);
            const idx = keyToIndex.get(itemKey) ?? -1;
            return (
              <ListItem
                key={itemKey}
                disablePadding
                draggable
                onDragStart={() => setDraggingKey(itemKey)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const sourceIdx = draggingKey ? (keyToIndex.get(draggingKey) ?? -1) : -1;
                  movePinned(sourceIdx, idx);
                  setDraggingKey(null);
                }}
                onDragEnd={() => setDraggingKey(null)}
                sx={{
                  '&:hover .pin-actions': { opacity: 1 },
                  '&:focus-within .pin-actions': { opacity: 1 },
                }}
              >
                <ListItemButton
                  onClick={() => onNavigateToPinned({ id: item.id, type: item.type })}
                  sx={{ gap: 0.5 }}
                >
                  <ListItemIcon sx={{ minWidth: 34, color: getObjectColor(item.type).text }}>
                    {objectIcon(item.type)}
                  </ListItemIcon>
                  <ListItemText
                    primary={item.title}
                    slotProps={{
                      primary: {
                        variant: 'body2',
                        sx: {
                          fontSize: '12px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        },
                      },
                    }}
                  />
                  <Box className="pin-actions" sx={{ display: 'flex', alignItems: 'center', opacity: 0, transition: 'opacity 120ms ease' }}>
                    <IconButton
                      size="small"
                      aria-label="Move pinned item up"
                      disabled={idx <= 0}
                      onClick={(event) => {
                        event.stopPropagation();
                        movePinned(idx, idx - 1);
                      }}
                      sx={{ color: '#7dbad6' }}
                    >
                      <ArrowUpwardIcon sx={{ fontSize: 13 }} />
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label="Move pinned item down"
                      disabled={idx < 0 || idx >= pinnedItems.length - 1}
                      onClick={(event) => {
                        event.stopPropagation();
                        movePinned(idx, idx + 1);
                      }}
                      sx={{ color: '#7dbad6' }}
                    >
                      <ArrowDownwardIcon sx={{ fontSize: 13 }} />
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label="Unpin item"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleUnpin(item);
                      }}
                      sx={{ color: '#7dbad6' }}
                    >
                      <CloseIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Box>
                </ListItemButton>
              </ListItem>
            );
          })}
        </Collapse>
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

function StackedPinnedHeader({ loadingPinned, count }: { loadingPinned: boolean; count: number }) {
  return (
    <Box sx={{ px: 2, py: 0.75, display: 'flex', alignItems: 'center', gap: 1 }}>
      <PushPinIcon sx={{ fontSize: 14, color: '#7dbad6' }} />
      <Typography variant="caption" sx={{ color: '#7dbad6', textTransform: 'uppercase', letterSpacing: '0.07em', fontSize: '10px', flex: 1 }}>
        Pinned
      </Typography>
      {loadingPinned ? <CircularProgress size={11} sx={{ color: '#7dbad6' }} /> : (
        <Typography variant="caption" sx={{ color: '#4a6a8a', fontSize: '10px' }}>
          {count}
        </Typography>
      )}
    </Box>
  );
}


