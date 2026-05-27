import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Loader2, Pin, PinOff, Plus, Save } from 'lucide-react';
import type { MentionOption } from '../common/MentionPopup'
import RichMarkdownEditor from '../common/RichMarkdownEditor'
import ObjectDirectoryBrowser from './ObjectDirectoryBrowser';
import { Button } from '../ui/button'
import { Alert } from '../ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import DatePicker from '../ui/date-picker'
import { Input } from '../ui/input'
import { deleteObject, getObject, resolveObjectFromLinkPath, writeObject, type ResolvedObjectRef } from '../../lib/cliService'
import { getTodayDate } from '../../lib/dateUtils'
import { useSyncStatus } from '../../lib/syncContext'
import type { NoteBlock } from '../../shared/types'

interface ObjectEditorProps {
  object?: Record<string, unknown>;
  type: 'topic-note' | 'daily-note' | 'project' | 'ref-material' | 'habit';
  flatTop?: boolean;
  onSave?: (saved: Record<string, unknown>) => void;
  onCancel?: () => void;
  onDirty?: (isDirty: boolean) => void;
  onNavigateToObject?: (target: ResolvedObjectRef, options?: { forceNewTab?: boolean }) => void | Promise<void>;
  onDateChange?: (date: string) => void | Promise<void>;
}


function normalizeSyncPath(path?: string): string | undefined {
  const value = (path ?? '').trim();
  return value && value !== '(no path)' ? value.replace(/\\/g, '/') : undefined;
}

function isExternalHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function openExternalUrl(value: string): void {
  if (typeof window === 'undefined') return;
  window.open(value, '_blank', 'noopener,noreferrer');
}

function isEffectivelyEmptyNoteContent(value: string): boolean {
  const normalized = value
    .replace(/<br\s*\/?>/gi, '')
    .replace(/&nbsp;/gi, '')
    .trim();
  return normalized.length === 0;
}

function normalizeTagValue(tag: string): string {
  return String(tag ?? '').trim().replace(/^#/, '').toLowerCase();
}

function isPinnedTag(tag: string): boolean {
  return normalizeTagValue(tag) === 'pinned';
}

function fallbackBlockId(index: number): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(16)}${index.toString(16).padStart(2, '0')}`;
  return `blk-${random.slice(0, 12).padEnd(12, '0')}`;
}

function parseLegacyBlocksFromMarkdown(contentMarkdown: string): NoteBlock[] {
  const raw = String(contentMarkdown ?? '').replace(/\r\n/g, '\n').trimEnd();
  if (!raw) return [];
  const paragraphs = raw.split('\n\n').map((p) => p.trimEnd());
  return paragraphs.map((paragraph, index) => {
    const match = /\s*<!--\s*(blk-[a-f0-9]{12})\s*-->\s*$/.exec(paragraph);
    return {
      blockId: match?.[1] ?? fallbackBlockId(index),
      position: index,
      contentMarkdown: match ? paragraph.slice(0, match.index).trimEnd() : paragraph,
    };
  });
}

function normalizeNoteBlocks(
  rawBlocks: unknown,
  contentMarkdown: string,
): NoteBlock[] {
  if (Array.isArray(rawBlocks)) {
    const parsed = rawBlocks
      .map((rawBlock, index) => {
        if (!rawBlock || typeof rawBlock !== 'object') return null;
        const block = rawBlock as Record<string, unknown>;
        const blockId =
          typeof block.blockId === 'string' && block.blockId
            ? block.blockId
            : fallbackBlockId(index);
        const position =
          typeof block.position === 'number' ? block.position : index;
        const blockContent =
          typeof block.contentMarkdown === 'string' ? block.contentMarkdown : '';
        return { blockId, position, contentMarkdown: blockContent };
      })
      .filter((block): block is NoteBlock => Boolean(block))
      .sort((a, b) => a.position - b.position)
      .map((block, index) => ({ ...block, position: index }));
    if (parsed.length > 0) return parsed;
  }
  return parseLegacyBlocksFromMarkdown(contentMarkdown);
}

function joinBlockMarkdown(blocks: NoteBlock[]): string {
  if (blocks.length === 0) return '';
  return blocks
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((block) => block.contentMarkdown)
    .join('\n\n');
}

export default function ObjectEditor({ object, type, flatTop = false, onSave, onCancel, onDirty, onNavigateToObject, onDateChange }: ObjectEditorProps) {
  const { triggerSyncInBackground } = useSyncStatus();
  const defaultDate =
    type === 'daily-note' || type === 'habit' ? getTodayDate() : '';

  // Keep a stable ref to the latest onDirty callback so that effects that
  // should only re-run on data changes (not callback identity changes) can
  // call the current version without listing onDirty as a dependency.
  const onDirtyRef = useRef(onDirty);
  useEffect(() => {
    onDirtyRef.current = onDirty;
  });

  const initialRef = useRef<{ title: string; author: string; date: string; content: string; tags: string[] }>({
    title: '',
    author: '',
    date: defaultDate,
    content: '',
    tags: [],
  });

  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [content, setContent] = useState('');
  const [noteBlocks, setNoteBlocks] = useState<NoteBlock[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [showTagDialog, setShowTagDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<{ target: ResolvedObjectRef; options?: { forceNewTab?: boolean } } | null>(null);
  const [pendingDeleteReason, setPendingDeleteReason] = useState<'empty-note' | 'untagged-habit' | null>(null);
  const [liveForwardLinks, setLiveForwardLinks] = useState<Array<Record<string, unknown>>>([]);
  const [liveBacklinkLinks, setLiveBacklinkLinks] = useState<Array<Record<string, unknown>>>([]);
  const mentionTargetBlockCacheRef = useRef(new Map<string, string | null>());
  const tagInputRef = useRef<HTMLInputElement | null>(null);

  // Reset form when a different object payload is loaded.
  useEffect(() => {
    const nextTitle = (object?.title as string) || (object?.name as string) || '';
    const nextAuthor = (object?.author as string) || '';
    const nextDate =
      (object?.date as string | undefined) ??
      (object?.startDate as string | undefined) ??
      defaultDate;
    const nextRawContent =
      (type === 'habit' ? (object?.text as string) : (object?.contentMarkdown as string)) || '';
    const nextBlocks =
      type === 'topic-note' || type === 'daily-note'
        ? normalizeNoteBlocks(object?.blocks, nextRawContent)
        : [];
    const nextContent =
      type === 'topic-note' || type === 'daily-note'
        ? joinBlockMarkdown(nextBlocks)
        : nextRawContent;
    const nextTags = (object?.tags as string[]) || [];

    initialRef.current = {
      title: nextTitle,
      author: nextAuthor,
      date: nextDate,
      content: nextContent,
      tags: [...nextTags],
    };

    setTitle(nextTitle);
    setAuthor(nextAuthor);
    setDate(nextDate);
    setContent(nextContent);
    setNoteBlocks(nextBlocks);
    setTags(nextTags);
    setSaveError(null);
    setIsDirty(false);
    setPendingNavigation(null);
    mentionTargetBlockCacheRef.current = new Map();
    onDirtyRef.current?.(false);
  }, [object, defaultDate, type]);

  useEffect(() => {
    const initialForward = Array.isArray(object?.links)
      ? (object.links as Array<Record<string, unknown>>)
      : [];
    const initialBacklinks = Array.isArray(object?.backlinks)
      ? (object.backlinks as Array<Record<string, unknown>>)
      : [];
    setLiveForwardLinks(initialForward);
    setLiveBacklinkLinks(initialBacklinks);
  }, [object]);

  useEffect(() => {
    const objectId = String(object?.id ?? '').trim();
    if (!objectId) return;

    let cancelled = false;
    const refreshRelations = async () => {
      try {
        const refreshed = await getObject(type, objectId);
        if (cancelled) return;
        const nextForward = Array.isArray((refreshed as { links?: unknown }).links)
          ? (((refreshed as unknown as { links: Array<Record<string, unknown>> }).links) ?? [])
          : [];
        const nextBacklinks = Array.isArray((refreshed as { backlinks?: unknown }).backlinks)
          ? (((refreshed as unknown as { backlinks: Array<Record<string, unknown>> }).backlinks) ?? [])
          : [];
        setLiveForwardLinks(nextForward);
        setLiveBacklinkLinks(nextBacklinks);
      } catch {
        // Keep existing relationship chips if refresh fails.
      }
    };

    const handleObjectsUpdated = () => {
      void refreshRelations();
    };

    window.addEventListener('puzzlepkm:objects-updated', handleObjectsUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener('puzzlepkm:objects-updated', handleObjectsUpdated);
    };
  }, [object?.id, type]);

  const resolveMentionHref = useCallback(
    async (option: MentionOption) => {
      const baseHref = option.id.trim();
      if (!baseHref) return '';

      const isNoteTarget =
        option.type === 'topic-note' || option.type === 'daily-note';
      if (!isNoteTarget) return baseHref;

      const cacheKey = `${option.type}:${option.id}`;
      if (!mentionTargetBlockCacheRef.current.has(cacheKey)) {
        try {
          const noteType = option.type === 'topic-note' ? 'topic-note' : 'daily-note';
          const note = await getObject(noteType, option.id);
          const blocks = Array.isArray((note as { blocks?: unknown }).blocks)
            ? ((note as { blocks: NoteBlock[] }).blocks ?? [])
            : [];
          const firstBlockId = blocks.find((block) => typeof block?.blockId === 'string' && block.blockId)?.blockId ?? null;
          mentionTargetBlockCacheRef.current.set(cacheKey, firstBlockId);
        } catch {
          mentionTargetBlockCacheRef.current.set(cacheKey, null);
        }
      }

      const blockId = mentionTargetBlockCacheRef.current.get(cacheKey);
      if (!blockId) return baseHref;
      const withoutFragment = baseHref.replace(/#.*/, '');
      return `${withoutFragment}#${blockId}`;
    },
    [],
  );

  const closeTagDialog = useCallback(() => {
    setShowTagDialog(false);
    setNewTag('');
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, []);

  const handleAddTag = useCallback((): boolean => {
    const tag = newTag.trim().toLowerCase();
    if (!tag) return false;

    if (tag) {
      if (type === 'habit') {
        setTags([tag]);
      } else if (!tags.includes(tag)) {
        setTags([...tags, tag]);
      }
      setNewTag('');
      return true;
    }
    return false;
  }, [newTag, tags, type]);

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  useEffect(() => {
    if (!showTagDialog) return;
    const frame = window.requestAnimationFrame(() => {
      tagInputRef.current?.focus();
      tagInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [showTagDialog]);

  const persistCurrentObject = useCallback(async (tagsOverride?: string[]): Promise<Record<string, unknown>> => {
    const tagsToPersist = tagsOverride ?? tags;
    setSaving(true);
    setSaveError(null);
    try {
      const data: Record<string, unknown> = {
        id: object?.id,
        tags: tagsToPersist,
      };

      if (type === 'topic-note') {
        data.title = title;
        data.date = date;
        data.contentMarkdown = content;
        data.blocks = noteBlocks;
        data.linkedObjectIds = (object?.linkedObjectIds as string[]) ?? [];
      } else if (type === 'daily-note') {
        data.date = date;
        data.contentMarkdown = content;
        data.blocks = noteBlocks;
        data.linkedObjectIds = (object?.linkedObjectIds as string[]) ?? [];
      } else if (type === 'project') {
        data.name = title;
        data.startDate = date || undefined;
        data.syncPath = (object?.syncPath as string) ?? '';
      } else if (type === 'ref-material') {
        data.name = title;
        data.author = author || '';
        data.syncPath = ((object?.syncPath as string) ?? (object?.syncPath as string)) ?? '';
      } else if (type === 'habit') {
        data.text = content;
        data.date = date;
      }

      const saved = await writeObject(type, data);
      initialRef.current = {
        title,
        author,
        date,
        content,
        tags: [...tagsToPersist],
      };
      setTags(tagsToPersist);
      setIsDirty(false);
      onDirty?.(false);
      window.dispatchEvent(new Event('puzzlepkm:objects-updated'));
      // Queue sync after save without extending the save interaction.
      triggerSyncInBackground();
      return saved;
    } catch (err) {
      setSaveError(String(err));
      throw err;
    } finally {
      setSaving(false);
    }
  }, [author, content, date, noteBlocks, object?.syncPath, object?.id, object?.linkedObjectIds, onDirty, tags, title, triggerSyncInBackground, type]);

  const isPinned = tags.some(isPinnedTag);
  const canPin = type === 'topic-note' || type === 'daily-note' || type === 'habit' || type === 'project' || type === 'ref-material';
  const handleTogglePinned = useCallback(async () => {
    if (!canPin) return;
    const nextTags = isPinned
      ? tags.filter((tag) => !isPinnedTag(tag))
      : [...tags.filter((tag) => !isPinnedTag(tag)), 'pinned'];
    setTags(nextTags);
    try {
      const saved = await persistCurrentObject(nextTags);
      onSave?.(saved);
    } catch {
      // Error already set by persistCurrentObject.
    }
  }, [canPin, isPinned, onSave, persistCurrentObject, tags]);

  const handleSave = async () => {
    const isEmptyNoteContent =
      (type === 'topic-note' || type === 'daily-note') &&
      isEffectivelyEmptyNoteContent(content);
    const isHabitWithoutTags = type === 'habit' && tags.length === 0;

    const hasDailyRelations =
      type === 'daily-note' &&
      ((Array.isArray(object?.links) && object.links.length > 0) ||
        (Array.isArray(object?.backlinks) && object.backlinks.length > 0) ||
        tags.length > 0);

    if (isEmptyNoteContent && !hasDailyRelations) {
      setPendingDeleteReason('empty-note');
      return;
    }
    if (isHabitWithoutTags) {
      setPendingDeleteReason('untagged-habit');
      return;
    }

    try {
      const saved = await persistCurrentObject();
      onSave?.(saved);
    } catch {
      // Error already set in state by persistCurrentObject
    }
  };

  const handleConfirmDeleteOnSave = async () => {
    if (!pendingDeleteReason) return;

    const id = (object?.id as string | undefined) ?? '';
    const hasPersistedObject = Boolean(id);

    setSaving(true);
    setSaveError(null);
    try {
      if (hasPersistedObject) {
        // Pre-sync the current editor state (e.g. removed tags) to the DB
        // before attempting deletion. The CLI eligibility check reads the DB
        // directly, so unsaved changes (like a removed tag) would otherwise
        // cause the delete to be incorrectly rejected.
        try {
          await persistCurrentObject();
        } catch {
          // Pre-sync failure is non-fatal — proceed to the delete attempt.
          // If the DB state still blocks deletion, the error surfaces below.
        }
        // persistCurrentObject resets saving to false in its finally block;
        // re-establish the saving state for the delete step.
        setSaving(true);
        setSaveError(null);

        try {
          await deleteObject(type, id);
        } catch (err) {
          const message = String(err instanceof Error ? err.message : err).toLowerCase();
          if (!message.includes('not found')) {
            setSaveError(String(err));
            return;
          }
        }
        triggerSyncInBackground();
      }

      setPendingDeleteReason(null);
      setIsDirty(false);
      onDirty?.(false);
      onSave?.({ id: id || undefined, type, deleted: true });
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const executeNavigation = useCallback(async (target: ResolvedObjectRef, options?: { forceNewTab?: boolean }) => {
    if (!onNavigateToObject) return;
    await onNavigateToObject(target, options);
  }, [onNavigateToObject]);

  const handleShiftClickLink = useCallback(async (href: string, options?: { forceNewTab?: boolean }) => {
    const normalizedHref = href.trim();
    if (isExternalHttpUrl(normalizedHref)) {
      openExternalUrl(normalizedHref);
      return;
    }

    if (!onNavigateToObject) return;
     try {
       const currentPath = normalizeSyncPath((object?.syncPath as string | undefined) ?? '');
       const target = await resolveObjectFromLinkPath(normalizedHref, currentPath);
 
       if (!target) {
         setSaveError(`Could not resolve linked object: ${normalizedHref}`);
         return;
       }

       if (isDirty) {
         setPendingNavigation({ target, options });
         return;
       }

       await executeNavigation(target, options);
     } catch (err) {
       setSaveError(`Failed to open linked object: ${String(err)}`);
     }
  }, [executeNavigation, isDirty, object?.syncPath, onNavigateToObject]);

  const handleDiscardAndNavigate = async () => {
    if (!pendingNavigation) return;
    setPendingNavigation(null);
    setIsDirty(false);
    onDirty?.(false);
    await executeNavigation(pendingNavigation.target, pendingNavigation.options);
  };

  const handleSaveAndNavigate = async () => {
    if (!pendingNavigation) return;
    try {
      const saved = await persistCurrentObject();
      // Notify the parent so it can update the tab object in its own state.
      // Without this the tab would still hold the pre-edit object and the
      // editor would show stale content when the user navigates back to it.
      onSave?.(saved);
      await executeNavigation(pendingNavigation.target, pendingNavigation.options);
      setPendingNavigation(null);
    } catch {
      // keep prompt open if save failed
    }
  };

  // Detect unsaved changes
  useEffect(() => {
    const baseline = initialRef.current;
    const isDirty =
      title !== baseline.title ||
      author !== baseline.author ||
      date !== baseline.date ||
      content !== baseline.content ||
      JSON.stringify(tags) !== JSON.stringify(baseline.tags);
    setIsDirty(isDirty);
    onDirtyRef.current?.(isDirty);
  }, [title, author, date, content, tags]);

  useEffect(() => {
    if (type !== 'daily-note' || !onDateChange) return;
    void onDateChange(date);
  }, [date, onDateChange, type]);

  const isNoteType = type === 'topic-note' || type === 'daily-note';
  const isFileObject = type === 'project' || type === 'ref-material';
  const forwardLinks = liveForwardLinks;
  const backlinkLinks = liveBacklinkLinks;
  const relationLabel = (relation: Record<string, unknown>) => {
    const rawTitle = String(relation.title ?? '').trim();
    const rawName = String(relation.name ?? '').trim();
    const rawText = String(relation.text ?? '').trim();
    const rawDate = String(relation.date ?? '').trim();
    const relationType = String(relation.type ?? '').trim();
    if (relationType === 'daily-note' && rawDate) return rawDate;
    if (rawTitle) return rawTitle;
    if (rawName) return rawName;
    if (rawText) return rawText;
    if (rawDate) return rawDate;
    return String(relation.id ?? '');
  };
  const relationToTarget = (relation: Record<string, unknown>): ResolvedObjectRef | null => {
    const id = String(relation.id ?? '').trim();
    const relationType = String(relation.type ?? '').trim() as ResolvedObjectRef['type'];
    const syncPath = String(relation.syncPath ?? '').trim();
    if (!id || !relationType) return null;
    return {
      id,
      type: relationType,
      syncPath,
    };
  };
  const handleRelationClick = async (
    relation: Record<string, unknown>,
    event: React.MouseEvent,
  ) => {
    const target = relationToTarget(relation);
    if (!target || !onNavigateToObject) return;
    await onNavigateToObject(target, { forceNewTab: event.metaKey || event.ctrlKey });
  };
  const showTitle = type !== 'daily-note' && type !== 'habit';
  const showDate = type === 'daily-note' || type === 'topic-note' || type === 'project' || type === 'habit';
  const isOptionalDate = type === 'topic-note' || type === 'project';
  const showContent = type !== 'project' && type !== 'ref-material';
  const isHabit = type === 'habit';
  const tagsEditor = (
    <>
      <div className="mb-4 flex items-center gap-2">
        <p className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
          Tags
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setShowTagDialog(true)}
          className="h-6 w-6 text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)]"
          aria-label="Add tag"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {tags.length === 0 && (
          <p className="text-xs italic text-[var(--color-text-disabled)]">
            No tags — click + to add
          </p>
        )}
        {tags.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => handleRemoveTag(tag)}
            className="inline-flex h-[22px] items-center gap-1 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-control)] px-2.5 text-sm text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-hover)]"
            title="Remove tag"
          >
            <span>#{tag}</span>
            <span aria-hidden="true">×</span>
          </button>
        ))}
      </div>
    </>
  );

  const relationshipsSection = (
    <div className="mb-2 space-y-4">
      <div>
        <p className="mb-2 block text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
          Links
        </p>
        <div className="flex flex-wrap gap-2">
          {forwardLinks.length === 0 ? (
            <p className="text-xs italic text-[var(--color-text-disabled)]">
              No links
            </p>
          ) : (
            forwardLinks.map((relation) => (
              <button
                key={`forward-${String(relation.id)}`}
                type="button"
                disabled={Boolean(!relationToTarget(relation) || !onNavigateToObject)}
                onClick={(event) => { void handleRelationClick(relation, event); }}
                className="inline-flex h-[22px] items-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-control)] px-2.5 text-sm text-[var(--color-text-secondary)] transition-colors enabled:hover:border-[var(--color-border-strong)] enabled:hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {relationLabel(relation)}
              </button>
            ))
          )}
        </div>
      </div>
      <div>
        <p className="mb-2 block text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
          Backlinks
        </p>
        <div className="flex flex-wrap gap-2">
          {backlinkLinks.length === 0 ? (
            <p className="text-xs italic text-[var(--color-text-disabled)]">
              No backlinks
            </p>
          ) : (
            backlinkLinks.map((relation) => (
              <button
                key={`backlink-${String(relation.id)}`}
                type="button"
                disabled={Boolean(!relationToTarget(relation) || !onNavigateToObject)}
                onClick={(event) => { void handleRelationClick(relation, event); }}
                className="inline-flex h-[22px] items-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-control)] px-2.5 text-sm text-[var(--color-text-secondary)] transition-colors enabled:hover:border-[var(--color-border-strong)] enabled:hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {relationLabel(relation)}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div
      className={flatTop
        ? 'flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent'
        : 'flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] p-6'}
    >
      <div className={`flex min-h-0 flex-1 flex-col ${isFileObject ? 'overflow-visible' : 'overflow-hidden'}`}>
        {isFileObject ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className={flatTop ? 'min-h-0 flex-1 overflow-auto px-6 pb-2 pt-6' : 'min-h-0 flex-1 overflow-auto pb-2'}>
              <div className="space-y-5 py-1">
                <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-disabled)]">
                  {type === 'project' ? 'Project name' : 'Reference name'}
                </label>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={type === 'project' ? 'Project name…' : 'Reference title…'}
                  className="h-10 text-lg font-semibold"
                />
                </div>

                <div className="py-1">
                  {tagsEditor}
                </div>

                {showDate && (
                  <div className="w-full max-w-[320px] py-1">
                    <DatePicker
                      label={type === 'project' ? 'Start Date' : 'Date'}
                      value={date}
                      onChange={setDate}
                      helperText={!date && isOptionalDate ? 'No date set' : undefined}
                      allowClear={isOptionalDate}
                    />
                  </div>
                )}

                {type === 'ref-material' && (
                  <div className="space-y-2 py-1">
                  <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-disabled)]">
                    Author (optional)
                  </label>
                  <Input
                    value={author}
                    onChange={(event) => setAuthor(event.target.value)}
                    placeholder="Author name…"
                  />
                  </div>
                )}

                <div className="min-h-[280px] overflow-hidden py-1">
                  <ObjectDirectoryBrowser object={object} type={type} embedded />
                </div>

                <div className="shrink-0 border-t border-[var(--color-border-subtle)] pt-6">
                  {relationshipsSection}
                </div>
              </div>
            </div>

            <div className={flatTop ? 'shrink-0 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] px-6 pb-6 pt-6' : 'shrink-0 border-t border-[var(--color-border-subtle)] pt-6'}>
              <div className="flex shrink-0 justify-end gap-2">
                {saveError && (
                  <Alert variant="destructive" className="mr-auto flex-1 py-2 text-xs">
                    {saveError}
                  </Alert>
                )}
                {onCancel && (
                  <Button variant="outline" onClick={onCancel} disabled={saving} size="sm">
                    Cancel
                  </Button>
                )}
                {canPin && (
                  <Button
                    type="button"
                    variant={isPinned ? 'outline' : 'ghost'}
                    onClick={() => { void handleTogglePinned(); }}
                    disabled={saving}
                    size="sm"
                    title={isPinned ? 'Remove from Pinned' : 'Pin to sidebar'}
                  >
                    {isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                    {isPinned ? 'Unpin' : 'Pin'}
                  </Button>
                )}
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  size="sm"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className={flatTop ? 'min-h-0 flex-1 overflow-auto px-6 pb-2 pt-6' : 'min-h-0 flex-1 overflow-auto pb-2'}>
              {/* ── TOP: Title and Date (always first) ── */}
              <div className="mb-6 shrink-0 space-y-5 py-1">

                {showTitle && (
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-disabled)]">
                      {type === 'topic-note' ? 'Title' : 'Name'}
                    </label>
                    <Input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder={type === 'topic-note' ? 'Note title…' : 'Name…'}
                      className="h-10 text-lg font-semibold"
                    />
                  </div>
                )}

                {isNoteType && !isHabit && (
                  <div className="py-1">
                    {tagsEditor}
                  </div>
                )}

                {isHabit && (
                  <div className="py-1">
                    {tagsEditor}
                  </div>
                )}

                {showDate && (
                  <div className="w-full max-w-[320px] py-1">
                      <DatePicker
                        label="Date"
                        value={date}
                        onChange={setDate}
                        helperText={!date && isOptionalDate ? 'No date set' : undefined}
                        allowClear={isOptionalDate}
                      />
                  </div>
                )}
              </div>

              {/* ── MIDDLE: Main content (fills remaining space) ── */}
              {showContent && (
                <div className="relative mb-2 flex min-h-0 overflow-hidden">
                  <RichMarkdownEditor
                    label={type === 'habit' ? 'Habit text (optional)' : 'Content'}
                    value={content}
                    onChange={setContent}
                    placeholder={
                      isNoteType
                        ? 'Write your note… type @ to link another object'
                        : type === 'habit' ? 'Optional habit notes…' : 'Any notes…'
                    }
                    mentionEnabled={isNoteType}
                    resolveMentionHref={resolveMentionHref}
                    blocks={isNoteType ? noteBlocks : undefined}
                    onBlocksChange={isNoteType ? setNoteBlocks : undefined}
                    maxLength={type === 'habit' ? 255 : undefined}
                    onShiftClickLink={handleShiftClickLink}
                  />
                </div>
              )}

              {/* ── BOTTOM: Relationships + Tags ── */}
              <div className="min-h-0 shrink-0 border-t border-[var(--color-border-subtle)] pt-6">
                {isNoteType && relationshipsSection}
              </div>
            </div>

            <div className={flatTop ? 'shrink-0 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] px-6 pb-6 pt-6' : 'shrink-0 border-t border-[var(--color-border-subtle)] pt-6'}>
              <div className="flex shrink-0 justify-end gap-2">
                {saveError && (
                  <Alert variant="destructive" className="mr-auto flex-1 py-2 text-xs">
                    {saveError}
                  </Alert>
                )}
                {onCancel && (
                  <Button variant="outline" onClick={onCancel} disabled={saving} size="sm">
                    Cancel
                  </Button>
                )}
                {canPin && (
                  <Button
                    type="button"
                    variant={isPinned ? 'outline' : 'ghost'}
                    onClick={() => { void handleTogglePinned(); }}
                    disabled={saving}
                    size="sm"
                    title={isPinned ? 'Remove from Pinned' : 'Pin to sidebar'}
                  >
                    {isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                    {isPinned ? 'Unpin' : 'Pin'}
                  </Button>
                )}
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  size="sm"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Tag dialog */}
      <Dialog open={showTagDialog} onOpenChange={(open) => { if (!open) closeTagDialog(); }}>
        {showTagDialog ? (
          <DialogContent className="max-w-sm" aria-label="Add Tag">
            <DialogHeader>
              <DialogTitle>Add Tag</DialogTitle>
              <DialogDescription>
                Add a lowercase tag to this object.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1">
              <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-disabled)]">
                Tag name
              </label>
              <Input
                autoFocus
                ref={tagInputRef}
                value={newTag}
                onChange={(e) => setNewTag(e.target.value.toLowerCase())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (handleAddTag()) closeTagDialog();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    closeTagDialog();
                  }
                }}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeTagDialog}>Cancel</Button>
              <Button
                onClick={() => {
                  if (handleAddTag()) closeTagDialog();
                }}
              >
                Add
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={!!pendingNavigation} onOpenChange={(open) => { if (!open) setPendingNavigation(null); }}>
        {pendingNavigation ? (
          <DialogContent className="max-w-sm" aria-label="Unsaved Changes">
            <DialogHeader>
              <DialogTitle>Unsaved Changes</DialogTitle>
              <DialogDescription>
                You have unsaved changes. Save before opening the linked object?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPendingNavigation(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => { void handleDiscardAndNavigate(); }}>
                Discard
              </Button>
              <Button onClick={() => { void handleSaveAndNavigate(); }} disabled={saving}>
                Save &amp; Open
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog
        open={!!pendingDeleteReason}
        onOpenChange={(open) => {
          if (!open && !saving) setPendingDeleteReason(null);
        }}
      >
        {pendingDeleteReason ? (
          <DialogContent className="max-w-sm" aria-label="Confirm Delete">
            <DialogHeader>
              <DialogTitle>Confirm Delete</DialogTitle>
              <DialogDescription>
                {pendingDeleteReason === 'empty-note'
                  ? 'This note has empty content. Delete it instead of saving?'
                  : 'This habit has no tags. Delete it instead of saving?'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPendingDeleteReason(null)} disabled={saving}>Cancel</Button>
              <Button variant="destructive" onClick={() => { void handleConfirmDeleteOnSave(); }} disabled={saving}>
                {saving ? 'Deleting…' : 'Delete'}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
