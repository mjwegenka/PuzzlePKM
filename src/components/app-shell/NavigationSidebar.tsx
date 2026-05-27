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
import { alpha } from '@mui/material/styles';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import FolderIcon from '@mui/icons-material/Folder';
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks';
import HubIcon from '@mui/icons-material/Hub';
import SettingsIcon from '@mui/icons-material/Settings';
import SyncIcon from '@mui/icons-material/Sync';
import PushPinIcon from '@mui/icons-material/PushPin';
import CloseIcon from '@mui/icons-material/Close';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import DescriptionIcon from '@mui/icons-material/Description';
import RepeatIcon from '@mui/icons-material/Repeat';
import { useSyncStatus } from '../../lib/syncContext'
import { formatDatePretty } from '../../lib/dateUtils'
import { getObject, listDailyNoteMeta, listFileMeta, listHabitMeta, listTopicNoteMeta, writeObject } from '../../lib/cliService'
import { cardSpacingTokens, neutralDarkTokens } from '../../theme'

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
const PINNED_ORDER_STORAGE_KEY = 'puzzlepkm:pinned-order:v1';
const SIDEBAR_WIDTH_STORAGE_KEY = 'puzzlepkm:sidebar-width:v1';
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 360;
const SIDEBAR_DEFAULT_WIDTH = 272;

const navItems: NavigationItem[] = [
  { id: 'library', label: 'Library', icon: <LibraryBooksIcon /> },
  { id: 'calendar', label: 'Calendar', icon: <CalendarTodayIcon /> },
  { id: 'graph', label: 'Graph', icon: <HubIcon /> },
];

const sidebarColors = {
  background: neutralDarkTokens.surface.app,
  backgroundTop: neutralDarkTokens.surface.app,
  border: 'transparent',
  divider: alpha(neutralDarkTokens.text.primary, 0.07),
  text: neutralDarkTokens.text.primary,
  textMuted: neutralDarkTokens.text.secondary,
  icon: neutralDarkTokens.text.secondary,
  iconMuted: neutralDarkTokens.text.muted,
  hover: alpha(neutralDarkTokens.text.primary, 0.04),
  selected: alpha(neutralDarkTokens.text.primary, 0.065),
  selectedBorder: neutralDarkTokens.border.subtle,
};

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

function normalizeTagValue(tag: string): string {
  return String(tag ?? '').trim().replace(/^#/, '').toLowerCase();
}

function isPinnedTag(tag: string): boolean {
  return normalizeTagValue(tag) === PINNED_TAG;
}

function objectIcon(type: PinnedType): React.ReactNode {
  if (type === 'daily-note') return <CalendarTodayIcon fontSize="small" />;
  if (type === 'habit') return <RepeatIcon fontSize="small" />;
  if (type === 'project' || type === 'ref-material') return <FolderIcon fontSize="small" />;
  return <DescriptionIcon fontSize="small" />;
}

export default function NavigationSidebar({ onNavigate, currentSection, onNavigateToPinned }: NavigationSidebarProps) {
  const { syncing, lastSyncedAt, syncError, triggerSync } = useSyncStatus();
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [pinnedItems, setPinnedItems] = useState<PinnedNavItem[]>([]);
  const [loadingPinned, setLoadingPinned] = useState(false);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    if (!Number.isFinite(parsed)) return;
    setSidebarWidth(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, parsed)));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  const handleResizeStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsResizing(true);
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const next = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, moveEvent.clientX));
      setSidebarWidth(next);
    };

    const handleMouseUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setIsResizing(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, []);

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
      const pinned = combined.filter((item) => item.tags.some((tag) => isPinnedTag(tag)));
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
    window.addEventListener('puzzlepkm:objects-updated', handleObjectsUpdated);
    return () => window.removeEventListener('puzzlepkm:objects-updated', handleObjectsUpdated);
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
    const nextTags = tags.filter((tag) => !isPinnedTag(tag));
    await writeObject(item.type, { ...current, tags: nextTags });
    setPinnedItems((prev) => {
      const next = prev.filter((entry) => !(entry.id === item.id && entry.type === item.type));
      persistPinnedOrder(next);
      return next;
    });
    window.dispatchEvent(new Event('puzzlepkm:objects-updated'));
  }, [persistPinnedOrder]);

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: sidebarWidth,
        flexShrink: 0,
        position: 'relative',
        '& .MuiDrawer-paper': {
          width: sidebarWidth,
          boxSizing: 'border-box',
          backgroundColor: sidebarColors.background,
          border: 'none',
          boxShadow: 'none',
          color: sidebarColors.text,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          px: 1,
          pt: 'calc(env(titlebar-area-height, 0px) + 30px)',
          pb: 1,
        },
      }}
    >
      <Box
        onMouseDown={handleResizeStart}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize navigation sidebar"
        sx={{
          position: 'absolute',
          top: 0,
          right: -2,
          width: 6,
          height: '100%',
          cursor: 'col-resize',
          zIndex: 2,
          '&::before': {
            content: '""',
            position: 'absolute',
            right: 2,
            top: 0,
            width: 1,
            height: '100%',
            bgcolor: (theme) => (isResizing ? alpha(theme.palette.accent.selected, 0.95) : 'transparent'),
          },
          '&:hover::before': {
            bgcolor: (theme) => alpha(theme.palette.accent.selected, 0.6),
          },
        }}
      />

      <List sx={{ flex: 1, overflow: 'auto', px: 0.5, py: 0.5 }}>
        {navItems.map((item) => (
          <ListItem key={item.id} disablePadding>
            <ListItemButton
              selected={currentSection === item.id}
              onClick={() => onNavigate(item.id)}
              sx={{
                minHeight: 38,
                px: 1,
                py: 0.25,
                borderRadius: '14px',
                color: sidebarColors.textMuted,
                transition: 'background-color 120ms ease, color 120ms ease, border-color 120ms ease',
                '&:hover': { bgcolor: sidebarColors.hover, color: sidebarColors.text },
                '&.Mui-selected': {
                  backgroundColor: sidebarColors.selected,
                  color: sidebarColors.text,
                  border: `1px solid ${sidebarColors.selectedBorder}`,
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 30, color: sidebarColors.icon }}>
                <Box sx={{ '& .MuiSvgIcon-root': { fontSize: 21 } }}>{item.icon}</Box>
              </ListItemIcon>
              <ListItemText primary={item.label} slotProps={{ primary: { variant: 'body2', sx: { fontSize: '13px', fontWeight: 500, lineHeight: 1.25 } } }} />
            </ListItemButton>
          </ListItem>
        ))}
        <Collapse in timeout="auto" unmountOnExit={false}>
          <Divider sx={{ borderColor: sidebarColors.divider, my: 1 }} />
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
                  sx={{
                    gap: 0.5,
                    minHeight: 32,
                    px: 0.9,
                    py: 0.25,
                    borderRadius: '10px',
                    color: sidebarColors.textMuted,
                    transition: 'background-color 120ms ease, color 120ms ease',
                    '&:hover': { bgcolor: sidebarColors.hover, color: sidebarColors.text },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 24, color: sidebarColors.iconMuted }}>
                    {objectIcon(item.type)}
                  </ListItemIcon>
                  <ListItemText
                    primary={item.title}
                    slotProps={{
                      primary: {
                        variant: 'body2',
                        sx: {
                          fontSize: '11px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          lineHeight: 1.25,
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
                      sx={{ color: sidebarColors.icon }}
                    >
                      <ArrowUpwardIcon sx={{ fontSize: 12 }} />
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label="Move pinned item down"
                      disabled={idx < 0 || idx >= pinnedItems.length - 1}
                      onClick={(event) => {
                        event.stopPropagation();
                        movePinned(idx, idx + 1);
                      }}
                      sx={{ color: sidebarColors.icon }}
                    >
                      <ArrowDownwardIcon sx={{ fontSize: 12 }} />
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label="Unpin item"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleUnpin(item);
                      }}
                      sx={{ color: sidebarColors.icon }}
                    >
                      <CloseIcon sx={{ fontSize: 13 }} />
                    </IconButton>
                  </Box>
                </ListItemButton>
              </ListItem>
            );
          })}
        </Collapse>
      </List>

      <Divider sx={{ borderColor: sidebarColors.divider }} />

      {/* ── Sync status + button ── */}
      <Box sx={{ px: 1.5, py: 1.1, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Tooltip title={syncError ?? (syncing ? 'Syncing…' : formatLastSynced(lastSyncedAt))} placement="right">
          <span>
            <IconButton
              size="small"
              onClick={triggerSync}
              disabled={syncing}
              sx={{ color: syncError ? 'error.main' : sidebarColors.icon, '&:hover': { color: sidebarColors.text } }}
            >
              {syncing
                ? <CircularProgress size={18} sx={{ color: sidebarColors.icon }} />
                : <SyncIcon sx={{ fontSize: 17 }} />}
            </IconButton>
          </span>
        </Tooltip>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              color: syncError ? 'error.main' : sidebarColors.textMuted,
              fontSize: '9.5px',
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

      <Divider sx={{ borderColor: sidebarColors.divider }} />

      <List sx={{ px: 0.5, py: 0.5 }}>
        <ListItem disablePadding>
          <ListItemButton
            selected={currentSection === 'settings'}
            onClick={() => onNavigate('settings')}
            sx={{
              minHeight: 38,
              px: 1,
              py: 0.25,
              borderRadius: '14px',
              color: sidebarColors.textMuted,
              transition: 'background-color 120ms ease, color 120ms ease, border-color 120ms ease',
              '&:hover': { bgcolor: sidebarColors.hover, color: sidebarColors.text },
              '&.Mui-selected': {
                backgroundColor: sidebarColors.selected,
                color: sidebarColors.text,
                border: `1px solid ${sidebarColors.selectedBorder}`,
              },
            }}
          >
            <ListItemIcon sx={{ minWidth: 30, color: sidebarColors.icon }}>
              <SettingsIcon sx={{ fontSize: 21 }} />
            </ListItemIcon>
            <ListItemText primary="Settings" slotProps={{ primary: { variant: 'body2', sx: { fontSize: '13px', fontWeight: 500, lineHeight: 1.25 } } }} />
          </ListItemButton>
        </ListItem>
      </List>
    </Drawer>
  );
}

function StackedPinnedHeader({ loadingPinned, count }: { loadingPinned: boolean; count: number }) {
  return (
    <Box
      sx={{
        px: cardSpacingTokens.sidebarRowPaddingX,
        py: 0.55,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        minHeight: 30,
      }}
    >
      <PushPinIcon sx={{ fontSize: 12, color: sidebarColors.iconMuted }} />
      <Typography variant="caption" sx={{ color: sidebarColors.textMuted, letterSpacing: '0.03em', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', flex: 1 }}>
        Pinned
      </Typography>
      {loadingPinned ? <CircularProgress size={11} sx={{ color: sidebarColors.iconMuted }} /> : (
        <Typography variant="caption" sx={{ color: sidebarColors.iconMuted, fontSize: '9px' }}>
          {count}
        </Typography>
      )}
    </Box>
  );
}
