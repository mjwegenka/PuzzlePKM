import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  CalendarDays,
  FileText,
  Folder,
  Hash,
  Loader2,
  Network,
  Pin,
  RefreshCw,
  Repeat,
  X,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { cn } from '../../lib/utils';
import { useSyncStatus } from '../../lib/syncContext';
import { formatDatePretty } from '../../lib/dateUtils';
import { getObject, listDailyNoteMeta, listFileMeta, listHabitMeta, listTags, listTopicNoteMeta, writeObject, type TagSummary } from '../../lib/cliService';
import { normalizeTagFilterValue, type TagFilterState } from '../../lib/tagFilters';

interface NavigationItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

interface NavigationSidebarProps {
  onNavigate: (section: string) => void;
  currentSection: string;
  onNavigateToPinned: (target: { id: string; type: 'topic-note' | 'daily-note' | 'habit' | 'project' | 'ref-material' }) => void | Promise<void>;
  tagFilters: TagFilterState;
  onToggleTagFilter: (tag: string) => void;
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
const SIDEBAR_DEFAULT_WIDTH = SIDEBAR_MIN_WIDTH;

const navItems: NavigationItem[] = [
  { id: 'library', label: 'Library', icon: <BookOpen className="h-[21px] w-[21px]" /> },
  { id: 'calendar', label: 'Calendar', icon: <CalendarDays className="h-[21px] w-[21px]" /> },
  { id: 'graph', label: 'Graph', icon: <Network className="h-[21px] w-[21px]" /> },
];

function withAlpha(color: string, opacity: number): string {
  const hex = color.trim();
  if (/^#([\da-fA-F]{6})$/.test(hex)) {
    const value = hex.slice(1);
    const r = Number.parseInt(value.slice(0, 2), 16);
    const g = Number.parseInt(value.slice(2, 4), 16);
    const b = Number.parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }

  const rgb = hex.match(/^rgb\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\)$/);
  if (rgb) {
    return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${opacity})`;
  }

  return color;
}

function formatLastSynced(date: Date | null): string {
  if (!date) return 'Never synced';
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 5) return 'Synced just now';
  if (diff < 60) return `Synced ${diff}s ago`;
  if (diff < 3600) return `Synced ${Math.floor(diff / 60)}m ago`;
  return `Synced ${Math.floor(diff / 3600)}h ago`;
}

function formatSyncStatusCompact(date: Date | null): string {
  if (!date) return 'Never';
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 5) return 'Just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
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
  if (type === 'daily-note') return <CalendarDays className="h-4 w-4" />;
  if (type === 'habit') return <Repeat className="h-4 w-4" />;
  if (type === 'project' || type === 'ref-material') return <Folder className="h-4 w-4" />;
  return <FileText className="h-4 w-4" />;
}

export default function NavigationSidebar({ onNavigate, currentSection, onNavigateToPinned, tagFilters, onToggleTagFilter }: NavigationSidebarProps) {
  const { syncing, lastSyncedAt, syncError, triggerSync } = useSyncStatus();
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [pinnedItems, setPinnedItems] = useState<PinnedNavItem[]>([]);
  const [tags, setTags] = useState<TagSummary[]>([]);
  const [loadingPinned, setLoadingPinned] = useState(false);
  const [loadingTags, setLoadingTags] = useState(false);
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

  const loadTags = useCallback(async () => {
    setLoadingTags(true);
    try {
      setTags(await listTags());
    } finally {
      setLoadingTags(false);
    }
  }, []);

  useEffect(() => {
    void loadPinnedItems();
    void loadTags();
  }, [loadPinnedItems, loadTags]);

  useEffect(() => {
    const handleObjectsUpdated = () => {
      void loadPinnedItems();
      void loadTags();
    };
    window.addEventListener('puzzlepkm:objects-updated', handleObjectsUpdated);
    return () => window.removeEventListener('puzzlepkm:objects-updated', handleObjectsUpdated);
  }, [loadPinnedItems, loadTags]);

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

  const syncTooltip = syncError ?? (syncing ? 'Syncing…' : formatLastSynced(lastSyncedAt));
  const hasActiveTagSelection = Object.values(tagFilters).some(Boolean);

  return (
    <TooltipProvider>
      <aside
        className="relative flex shrink-0 flex-col overflow-hidden bg-[var(--color-surface-app)] px-2 pb-2"
        style={{
          width: sidebarWidth,
          paddingTop: '12px',
        }}
      >
        <div
          onMouseDown={handleResizeStart}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize navigation sidebar"
          className="absolute right-[-2px] top-0 z-[2] h-full w-[6px] cursor-col-resize"
        >
          <div
            className="absolute right-[2px] top-0 h-full w-px transition-colors"
            style={{ backgroundColor: isResizing ? withAlpha('#f3efe7', 0.95) : 'transparent' }}
          />
        </div>

        <div className="ui-scroller flex flex-1 flex-col overflow-auto px-0.5 pb-2">
          <div className="mb-4 px-1 pb-2">
          {navItems.map((item) => {
            const selected = currentSection === item.id;
            return (
              <Button
                key={item.id}
                type="button"
                variant="ghost"
                onClick={() => onNavigate(item.id)}
                className={cn(
                  'mb-1 h-10 w-full justify-start gap-3 rounded-[12px] border px-3 py-2 text-[13px] font-semibold transition-[background-color,border-color,color]',
                  selected
                    ? 'border-[rgba(242,203,99,0.18)] bg-[var(--color-surface-control)] text-[var(--color-text-primary)]'
                    : 'border-transparent text-[var(--color-text-secondary)] hover:border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]',
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] border border-transparent bg-[var(--color-surface-sunken)]/60',
                    selected
                      ? 'border-[rgba(242,203,99,0.18)] bg-[var(--color-selected-fill-soft)] text-[var(--color-accent-metadata)]'
                      : 'text-[var(--color-text-disabled)]',
                  )}
                >
                  {item.icon}
                </span>
                <span className="truncate">{item.label}</span>
              </Button>
            );
          })}
          </div>

          {pinnedItems.length > 0 ? (
          <div className="mb-3 border-t border-[var(--color-border-subtle)]/70 px-0.5 pb-2 pt-2">
          <StackedPinnedHeader loadingPinned={loadingPinned} count={pinnedItems.length} />

          {pinnedItems.map((item) => {
            const itemKey = makePinnedKey(item);
            const idx = keyToIndex.get(itemKey) ?? -1;
            return (
              <div
                key={itemKey}
                className="group"
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
              >
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onNavigateToPinned({ id: item.id, type: item.type })}
                  className="relative mb-0.5 h-7.5 w-full justify-start gap-2 rounded-[8px] border border-transparent px-2.5 py-1 text-[var(--color-text-secondary)] hover:border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                >
                  <span className="flex h-4 w-4 items-center justify-center text-[var(--color-text-disabled)]">
                    {objectIcon(item.type)}
                  </span>
                  <span className="min-w-0 flex-1 truncate pr-2 text-left text-[11px] leading-[1.25]">{item.title}</span>
                  <span className="pin-actions absolute right-2 top-1/2 flex -translate-y-1/2 items-center rounded-[8px] bg-[var(--color-surface-app)] px-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Move pinned item up"
                      disabled={idx <= 0}
                      onClick={(event) => {
                        event.stopPropagation();
                        movePinned(idx, idx - 1);
                      }}
                      className="h-7 w-7 rounded-[8px] text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)]"
                    >
                      <ArrowUp className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Move pinned item down"
                      disabled={idx < 0 || idx >= pinnedItems.length - 1}
                      onClick={(event) => {
                        event.stopPropagation();
                        movePinned(idx, idx + 1);
                      }}
                      className="h-7 w-7 rounded-[8px] text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)]"
                    >
                      <ArrowDown className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Unpin item"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleUnpin(item);
                      }}
                      className="h-7 w-7 rounded-[8px] text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)]"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </span>
                </Button>
              </div>
            );
          })}
          </div>
          ) : null}

          <div className="mb-3 border-t border-[var(--color-border-subtle)]/70 px-0.5 pb-2 pt-2">
            <StackedTagsHeader loadingTags={loadingTags} count={tags.length} hasActiveFilters={hasActiveTagSelection} />
            {tags.length === 0 && !loadingTags ? (
              <div className="px-2.5 py-2 text-[11px] text-[var(--color-text-disabled)]">No tags yet</div>
            ) : null}
            <div className="flex flex-wrap gap-1.5 px-2 py-2">
              {tags.map((tag) => {
                const value = normalizeTagFilterValue(tag.name || tag.displayName);
                const mode = tagFilters[value];
                const label = tag.displayName || tag.name;
                const displayLabel = label.startsWith('#') ? label : `#${label}`;
                return (
                  <Button
                    key={tag.id}
                    type="button"
                    variant="ghost"
                    onClick={() => onToggleTagFilter(value)}
                    aria-pressed={Boolean(mode)}
                    className={cn(
                      'h-auto min-h-[24px] max-w-full justify-start rounded-[10px] border px-2 py-0.5 text-[8px] font-semibold leading-none transition-[background-color,border-color,color]',
                      mode === 'include'
                        ? 'border-[rgba(242,203,99,0.18)] bg-[var(--color-selected-fill-soft)] text-[var(--color-accent-metadata)]'
                        : mode === 'exclude'
                          ? 'border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] text-[var(--color-text-disabled)] line-through decoration-[var(--color-accent-metadata)] decoration-2'
                          : 'border-transparent bg-[var(--color-surface-control)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]',
                    )}
                    title={mode === 'include' ? `Included in current filter • ${tag.objectCount} objects. Click to exclude.` : mode === 'exclude' ? `Excluded from current filter • ${tag.objectCount} objects. Click to clear.` : `${tag.objectCount} objects. Click to include this tag.`}
                  >
                    <span className="truncate leading-none">{displayLabel}</span>
                  </Button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mb-2 border-t border-[var(--color-border-subtle)]/80 px-2 py-2.5">
          <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={triggerSync}
                  disabled={syncing}
                  className="h-10 w-10 rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
                  style={{ color: syncError ? 'var(--destructive)' : undefined }}
                >
                  {syncing ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <RefreshCw className="h-[17px] w-[17px]" />}
                </Button>
              </div>
            </TooltipTrigger>
            <TooltipContent side="right">{syncTooltip}</TooltipContent>
          </Tooltip>
          <div className="min-w-0 flex-1">
            <span
               className="block truncate whitespace-nowrap text-[10px] font-medium leading-[1.35]"
               style={{ color: syncError ? 'var(--destructive)' : 'var(--color-text-secondary)' }}
            >
              {syncing ? 'Syncing…' : syncError ? 'Sync error' : `Last sync ${formatSyncStatusCompact(lastSyncedAt)}`}
            </span>
          </div>
          </div>
        </div>

      </aside>
    </TooltipProvider>
  );
}

function StackedTagsHeader({ loadingTags, count, hasActiveFilters }: { loadingTags: boolean; count: number; hasActiveFilters: boolean }) {
  return (
    <div className="flex min-h-[28px] items-center gap-1.5 px-2 py-1">
      <Hash className="h-3.5 w-3.5 text-[var(--color-text-disabled)]" />
      <span className="flex-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--color-text-disabled)]">
        Tags
      </span>
      {loadingTags ? <Loader2 className="h-[11px] w-[11px] animate-spin text-[var(--color-text-disabled)]" /> : (
        <span className="text-[10px] font-medium text-[var(--color-accent-metadata)]">
          {count === 0 ? 'No tags' : hasActiveFilters ? 'Filtered' : 'All selected'}
        </span>
      )}
    </div>
  );
}

function StackedPinnedHeader({ loadingPinned, count }: { loadingPinned: boolean; count: number }) {
  return (
    <div className="flex min-h-[32px] items-center gap-1.5 px-2 py-1.5">
      <Pin className="h-3.5 w-3.5 text-[var(--color-text-disabled)]" />
      <span className="flex-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--color-text-disabled)]">
        Pinned
      </span>
      {loadingPinned ? <Loader2 className="h-[11px] w-[11px] animate-spin text-[var(--color-text-disabled)]" /> : (
        <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-[var(--color-surface-control)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--color-text-disabled)]">
          {count}
        </span>
      )}
    </div>
  );
}
