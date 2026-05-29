import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Pin, PinOff, Plus, Save, Trash2 } from 'lucide-react';
import type { MentionOption } from '../common/MentionPopup'
import RichMarkdownEditor from '../common/RichMarkdownEditor'
import ProjectFileBrowser from './ProjectFileBrowser';
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
import { AuthorSelect } from './AuthorSelect'
import { deleteObject, getObject, resolveObjectFromLinkPath, writeObject, listAuthors, createAuthor, deleteAuthor, listTags, type ResolvedObjectRef, type AuthorSummary } from '../../lib/cliService'
import { normalizeNoteBlocks, joinBlockMarkdown } from '../../lib/noteBlocks'
import { getTodayDate } from '../../lib/dateUtils'
import { getObjectDisplayTitle, isObjectType } from '../../lib/objectTypeDefinitions'
import { useSyncStatus } from '../../lib/syncContext'
import { cn } from '../../lib/utils'
import type { NoteBlock } from '../../shared/types'

interface ObjectEditorProps {
  object?: Record<string, unknown>;
  type: 'topic-note' | 'daily-note' | 'project' | 'ref-material' | 'habit';
  flatTop?: boolean;
  onSave?: (saved: Record<string, unknown>) => void;
  onSaveAndOpenPrevious?: () => void | Promise<void>;
  onSaveAndOpenNext?: () => void | Promise<void>;
  onCancel?: () => void;
  onDirty?: (isDirty: boolean) => void;
  onNavigateToObject?: (target: ResolvedObjectRef, options?: { forceNewTab?: boolean }) => void | Promise<void>;
  onDateChange?: (date: string) => void | Promise<void>;
  /** Block ID to scroll/focus in the editor after the object loads. */
  initialBlockId?: string;
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

function normalizeTagValue(tag: string): string {
  return String(tag ?? '').trim().replace(/^#/, '').toLowerCase();
}

function isPinnedTag(tag: string): boolean {
  return normalizeTagValue(tag) === 'pinned';
}

function dedupeNormalizedTags(tagNames: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const tagName of tagNames) {
    const normalized = normalizeTagValue(tagName);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    next.push(normalized);
  }
  return next;
}

export default function ObjectEditor({ object, type, flatTop = false, onSave, onSaveAndOpenPrevious, onSaveAndOpenNext, onCancel, onDirty, onNavigateToObject, onDateChange, initialBlockId }: ObjectEditorProps) {
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
  const [tagDialogTags, setTagDialogTags] = useState<string[]>([]);
  const [popularTagPills, setPopularTagPills] = useState<string[]>([]);
  const [popularTagsLoading, setPopularTagsLoading] = useState(false);
  const [tagDialogError, setTagDialogError] = useState<string | null>(null);
  const [navigationDialogError, setNavigationDialogError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<{ target: ResolvedObjectRef; options?: { forceNewTab?: boolean } } | null>(null);
  const [liveForwardLinks, setLiveForwardLinks] = useState<Array<Record<string, unknown>>>([]);
  const [liveBacklinkLinks, setLiveBacklinkLinks] = useState<Array<Record<string, unknown>>>([]);
  const mentionTargetBlockCacheRef = useRef(new Map<string, string | null>());
  const tagInputRef = useRef<HTMLInputElement | null>(null);

  // Authors catalog for ref-material type
  const [authors, setAuthors] = useState<AuthorSummary[]>([]);
  const [authorsLoading, setAuthorsLoading] = useState(false);

  useEffect(() => {
    if (type !== 'ref-material') return;
    setAuthorsLoading(true);
    void listAuthors().then((result) => {
      setAuthors(result);
      setAuthorsLoading(false);
    });
  }, [type]);

  const handleCreateAuthor = useCallback(async (name: string) => {
    await createAuthor(name);
    const updated = await listAuthors();
    setAuthors(updated);
  }, []);

  const handleDeleteAuthor = useCallback(async (name: string) => {
    await deleteAuthor(name);
    const updated = await listAuthors();
    setAuthors(updated);
  }, []);

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
    setNavigationDialogError(null);
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
    setTagDialogTags([]);
    setNewTag('');
    setTagDialogError(null);
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, []);

  const openTagDialog = useCallback(() => {
    setTagDialogError(null);
    setNewTag('');
    setTagDialogTags(dedupeNormalizedTags(tags));
    setShowTagDialog(true);
  }, [tags]);

  const handleAddDialogTag = useCallback((): boolean => {
    const tag = normalizeTagValue(newTag);
    setTagDialogError(null);
    if (!tag) return false;

    if (type === 'habit' && isPinnedTag(tag)) {
      setTagDialogError('Habits cannot be pinned. Remove the "pinned" tag.');
      return false;
    }

    setTagDialogTags((prev) => {
      if (prev.includes(tag)) return prev;
      if (type === 'habit') return [tag];
      return [...prev, tag];
    });
    setNewTag('');
    return true;
  }, [newTag, type]);

  const handleToggleDialogTag = useCallback((rawTag: string) => {
    const tag = normalizeTagValue(rawTag);
    if (!tag) return;
    setTagDialogError(null);
    if (type === 'habit' && isPinnedTag(tag)) {
      setTagDialogError('Habits cannot be pinned. Remove the "pinned" tag.');
      return;
    }
    setTagDialogTags((prev) => {
      if (prev.includes(tag)) return prev.filter((existing) => existing !== tag);
      if (type === 'habit') return [tag];
      return [...prev, tag];
    });
  }, [type]);

  const handleSaveTagDialog = useCallback(() => {
    let nextTags = [...tagDialogTags];
    const pendingTag = normalizeTagValue(newTag);
    if (pendingTag) {
      if (type === 'habit' && isPinnedTag(pendingTag)) {
        setTagDialogError('Habits cannot be pinned. Remove the "pinned" tag.');
        return;
      }
      if (type === 'habit') {
        nextTags = [pendingTag];
      } else if (!nextTags.includes(pendingTag)) {
        nextTags = [...nextTags, pendingTag];
      }
    }
    setTags(dedupeNormalizedTags(nextTags));
    closeTagDialog();
  }, [closeTagDialog, newTag, tagDialogTags, type]);

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

  useEffect(() => {
    if (!showTagDialog) return;
    let cancelled = false;
    setPopularTagsLoading(true);
    void listTags()
      .then((allTags) => {
        if (cancelled) return;
        const topPills = dedupeNormalizedTags(
          [...allTags]
            .sort((a, b) => b.objectCount - a.objectCount || a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }))
            .slice(0, 20)
            .map((tag) => tag.displayName || tag.name),
        );
        setPopularTagPills(topPills);
      })
      .catch(() => {
        if (cancelled) return;
        setPopularTagPills([]);
      })
      .finally(() => {
        if (cancelled) return;
        setPopularTagsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showTagDialog]);

  const tagDialogPills = useMemo(() => {
    const merged = [...popularTagPills];
    for (const assignedTag of tagDialogTags) {
      if (!merged.includes(assignedTag)) merged.push(assignedTag);
    }
    return merged;
  }, [popularTagPills, tagDialogTags]);

  const buildPersistPayload = useCallback((tagsOverride?: string[]): { data: Record<string, unknown>; tagsToPersist: string[] } => {
    const tagsToPersist = tagsOverride ?? tags;
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
      data.syncPath = (object?.syncPath as string) ?? '';
    } else if (type === 'habit') {
      data.text = content;
      data.date = date;
    }

    return { data, tagsToPersist };
  }, [author, content, date, noteBlocks, object?.id, object?.linkedObjectIds, object?.syncPath, tags, title, type]);

  const commitSavedSnapshot = useCallback((tagsToPersist: string[]) => {
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
  }, [author, content, date, onDirty, title, triggerSyncInBackground]);

  const persistCurrentObject = async (tagsOverride?: string[]): Promise<Record<string, unknown>> => {
    setSaving(true);
    setSaveError(null);
    try {
      const { data, tagsToPersist } = buildPersistPayload(tagsOverride);
      const saved = await writeObject(type, data);
      commitSavedSnapshot(tagsToPersist);
      return saved;
    } catch (err) {
      const message = String(err);
      if (showTagDialog) setTagDialogError(message);
      else if (pendingNavigation) setNavigationDialogError(message);
      else setSaveError(message);
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const isPinned = tags.some(isPinnedTag);
  const canPin = type === 'topic-note' || type === 'daily-note' || type === 'project' || type === 'ref-material';
  const canDelete = Boolean(object?.id) && (type === 'topic-note' || type === 'daily-note' || type === 'habit');

  // Habits require exactly one tag and a date before they can be saved.
  const habitSaveBlocker: string | null =
    type === 'habit'
      ? tags.length === 0
        ? 'Habits require exactly one tag.'
        : !date
          ? 'Habits require a date.'
          : null
      : null;
  const canSave = !habitSaveBlocker;
  const handleTogglePinned = async () => {
    if (!canPin) return;
    const nextTags = isPinned
      ? tags.filter((tag) => !isPinnedTag(tag))
      : [...tags.filter((tag) => !isPinnedTag(tag)), 'pinned'];
    setTags(nextTags);

    // If the editor is otherwise clean, pin/unpin should save immediately.
    // If there are other unsaved edits, keep the pin state local and let the
    // normal Save flow persist everything together.
    if (isDirty) return;

    try {
      const saved = await persistCurrentObject(nextTags);
      onSave?.(saved);
    } catch {
      // Error already set by persistCurrentObject.
    }
  };

  const handleSave = async () => {
    try {
      const saved = await persistCurrentObject();
      onSave?.(saved);
    } catch {
      // Error already set in state by persistCurrentObject
    }
  };

  const handleSaveAndOpenSibling = async (openSibling?: () => void | Promise<void>) => {
    if (!openSibling) return;
    try {
      const saved = await persistCurrentObject();
      onSave?.(saved);
      await openSibling();
    } catch {
      // Error already set in state by persistCurrentObject/openSibling.
    }
  };

  const handleDelete = async () => {
    if (!canDelete) return;
    const id = (object?.id as string | undefined) ?? '';
    if (!id) return;

    setDeleting(true);
    setSaveError(null);
    try {
      const { data, tagsToPersist } = buildPersistPayload();

      // Pre-sync the current editor state (for example, removed tags or a
      // cleared date) to the DB before attempting deletion. The CLI deletion
      // checks read the DB directly, so stale in-memory changes could block
      // the delete path incorrectly.
      try {
        await writeObject(type, data);
        commitSavedSnapshot(tagsToPersist);
        // Do not notify parent on pre-delete pre-sync writes.
        // The parent save handler reloads list state, which can reset
        // list scroll before the actual delete completion callback runs.
      } catch {
        // Pre-sync failure is non-fatal — proceed to the delete attempt.
        // If the DB state still blocks deletion, the error surfaces below.
      }

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
      setIsDirty(false);
      onDirty?.(false);
      onSave?.({ id: id || undefined, type, deleted: true });
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setDeleting(false);
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
    setNavigationDialogError(null);
    setPendingNavigation(null);
    setIsDirty(false);
    onDirty?.(false);
    await executeNavigation(pendingNavigation.target, pendingNavigation.options);
  };

  const handleSaveAndNavigate = async () => {
    if (!pendingNavigation) return;
    setNavigationDialogError(null);
    try {
      const saved = await persistCurrentObject();
      // Notify the parent so it can update the tab object in its own state.
      // Without this the tab would still hold the pre-edit object and the
      // editor would show stale content when the user navigates back to it.
      onSave?.(saved);
      await executeNavigation(pendingNavigation.target, pendingNavigation.options);
      setPendingNavigation(null);
      setNavigationDialogError(null);
    } catch (err) {
      setNavigationDialogError(String(err));
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
    const relationType = String(relation.type ?? '').trim();

    if (isObjectType(relationType)) {
      return getObjectDisplayTitle(relationType, relation);
    }

    const fallbackLabel = String(
      relation.title
      ?? relation.name
      ?? relation.text
      ?? relation.date
      ?? relation.id
      ?? '',
    ).trim();
    return fallbackLabel || 'Object';
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
          onClick={() => {
            openTagDialog();
          }}
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
            className="inline-flex min-h-[28px] items-center gap-1 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-control)] px-3 py-1 text-sm text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-hover)]"
            title="Remove tag"
          >
            <span className="ui-tag-text">#{tag}</span>
            <span aria-hidden="true">×</span>
          </button>
        ))}
      </div>
    </>
  );

  const relationshipsSection = (
    <div className="py-1.5 space-y-2">
      <div className="space-y-2">
        <p className="block text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
          Links
        </p>
        <div className="flex flex-wrap gap-2.5 pb-1 pt-0.5">
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
                className={cn('inline-flex min-h-[28px] items-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-control)] px-3 py-1 text-sm text-[var(--color-text-secondary)] transition-colors enabled:hover:border-[var(--color-border-strong)] enabled:hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60', String(relation.type ?? '').trim() === 'tag' ? 'ui-tag-text' : undefined)}
              >
                {relationLabel(relation)}
              </button>
            ))
          )}
        </div>
      </div>
      <div className="mt-[12px] space-y-2">
        <p className="block text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
          Backlinks
        </p>
        <div className="flex flex-wrap gap-2.5 pt-0.5">
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
                className={cn('inline-flex min-h-[28px] items-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-control)] px-3 py-1 text-sm text-[var(--color-text-secondary)] transition-colors enabled:hover:border-[var(--color-border-strong)] enabled:hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-60', String(relation.type ?? '').trim() === 'tag' ? 'ui-tag-text' : undefined)}
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
              <div className="space-y-6 py-2">
                <div className="space-y-3">
                <label className="block text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
                  {type === 'project' ? 'Project name' : 'Reference name'}
                </label>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={type === 'project' ? 'Project name…' : 'Reference title…'}
                  className="h-10 text-lg font-semibold"
                />
                </div>

                <div className="py-1.5">
                  {tagsEditor}
                </div>

                {showDate && (
                  <div className="w-full max-w-[320px] py-1.5">
                    <DatePicker
                      label={type === 'project' ? 'Start Date' : 'Date'}
                      labelClassName="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]"
                      value={date}
                      onChange={setDate}
                      helperText={!date && isOptionalDate ? 'No date set' : undefined}
                      allowClear={isOptionalDate}
                    />
                  </div>
                )}

                {type === 'ref-material' && (
                  <div className="space-y-3 py-1.5">
                  <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-disabled)]">
                    Author (optional)
                  </label>
                  <AuthorSelect
                    value={author}
                    onChange={setAuthor}
                    authors={authors}
                    loading={authorsLoading}
                    onCreateAuthor={handleCreateAuthor}
                    onDeleteAuthor={handleDeleteAuthor}
                    disabled={saving || deleting}
                  />
                  </div>
                )}

                <div className="min-h-[280px] overflow-hidden py-1">
                  <ProjectFileBrowser object={object} type={type} embedded />
                </div>

                <div className="shrink-0 border-t border-[var(--color-border-subtle)] pb-1 pt-2">
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
                  <Button variant="outline" onClick={onCancel} disabled={saving || deleting} size="sm">
                    Cancel
                  </Button>
                )}
                {canPin && (
                  <Button
                    type="button"
                    variant={isPinned ? 'outline' : 'ghost'}
                    onClick={() => { void handleTogglePinned(); }}
                    disabled={saving || deleting}
                    size="sm"
                    title={isPinned ? 'Remove from Pinned' : 'Pin to sidebar'}
                  >
                    {isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                    {isPinned ? 'Unpin' : 'Pin'}
                  </Button>
                )}
                {canDelete && (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => { void handleDelete(); }}
                    disabled={saving || deleting}
                    size="sm"
                    title="Delete this object"
                  >
                    {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    {deleting ? 'Deleting…' : 'Delete'}
                  </Button>
                )}
                {habitSaveBlocker && (
                  <Alert variant="destructive" className="mr-auto flex-1 py-2 text-xs">
                    {habitSaveBlocker}
                  </Alert>
                )}
                <Button
                  onClick={handleSave}
                  disabled={saving || deleting || !canSave}
                  size="sm"
                  title={habitSaveBlocker ?? undefined}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {saving ? 'Saving…' : 'Save'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { void handleSaveAndOpenSibling(onSaveAndOpenPrevious); }}
                  disabled={saving || deleting || !onSaveAndOpenPrevious || !canSave}
                  size="sm"
                  title="Save and open previous object"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { void handleSaveAndOpenSibling(onSaveAndOpenNext); }}
                  disabled={saving || deleting || !onSaveAndOpenNext || !canSave}
                  size="sm"
                  title="Save and open next object"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className={flatTop ? 'min-h-0 flex-1 overflow-auto px-6 pb-2 pt-6' : 'min-h-0 flex-1 overflow-auto pb-2'}>
              {/* ── TOP: Title and Date (always first) ── */}
              <div className="mb-7 shrink-0 space-y-6 py-2">

                {showTitle && (
                  <div className="space-y-3">
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
                  <div className="py-1.5">
                    {tagsEditor}
                  </div>
                )}

                {isHabit && (
                  <div className="py-1.5">
                    {tagsEditor}
                  </div>
                )}

                {showDate && (
                  <div className="w-full max-w-[320px] py-1.5">
                      <DatePicker
                        label="Date"
                        labelClassName="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]"
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
                isHabit ? (
                  <div className="mb-2 space-y-2">
                    <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-disabled)]">
                      Habit text (optional)
                    </label>
                    <Input
                      value={content}
                      onChange={(e) => setContent(e.target.value.replace(/\r?\n/g, ' '))}
                      placeholder="Habit text…"
                      maxLength={255}
                    />
                    <p className="text-xs text-[var(--color-text-disabled)]">
                      {content.length}/255
                    </p>
                  </div>
                ) : (
                  <div className="mb-2">
                    <RichMarkdownEditor
                      label="Content"
                      value={content}
                      onChange={setContent}
                      placeholder="Write your note… type @ to link another object"
                      mentionEnabled={isNoteType}
                      resolveMentionHref={resolveMentionHref}
                      blocks={isNoteType ? noteBlocks : undefined}
                      onBlocksChange={isNoteType ? setNoteBlocks : undefined}
                      onShiftClickLink={handleShiftClickLink}
                      scrollToBlockId={isNoteType ? initialBlockId : undefined}
                    />
                  </div>
                )
              )}

              {/* ── BOTTOM: Relationships + Tags ── */}
              <div className="min-h-0 shrink-0 border-t border-[var(--color-border-subtle)] pb-1 pt-2">
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
                {!saveError && habitSaveBlocker && (
                  <Alert variant="destructive" className="mr-auto flex-1 py-2 text-xs">
                    {habitSaveBlocker}
                  </Alert>
                )}
                {onCancel && (
                  <Button variant="outline" onClick={onCancel} disabled={saving || deleting} size="sm">
                    Cancel
                  </Button>
                )}
                {canPin && (
                  <Button
                    type="button"
                    variant={isPinned ? 'outline' : 'ghost'}
                    onClick={() => { void handleTogglePinned(); }}
                    disabled={saving || deleting}
                    size="sm"
                    title={isPinned ? 'Remove from Pinned' : 'Pin to sidebar'}
                  >
                    {isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                    {isPinned ? 'Unpin' : 'Pin'}
                  </Button>
                )}
                {canDelete && (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => { void handleDelete(); }}
                    disabled={saving || deleting}
                    size="sm"
                    title="Delete this object"
                  >
                    {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    {deleting ? 'Deleting…' : 'Delete'}
                  </Button>
                )}
                <Button
                  onClick={handleSave}
                  disabled={saving || deleting || !canSave}
                  size="sm"
                  title={habitSaveBlocker ?? undefined}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {saving ? 'Saving…' : 'Save'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { void handleSaveAndOpenSibling(onSaveAndOpenPrevious); }}
                  disabled={saving || deleting || !onSaveAndOpenPrevious || !canSave}
                  size="sm"
                  title="Save and open previous object"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { void handleSaveAndOpenSibling(onSaveAndOpenNext); }}
                  disabled={saving || deleting || !onSaveAndOpenNext || !canSave}
                  size="sm"
                  title="Save and open next object"
                >
                  <ChevronRight className="h-4 w-4" />
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
              <DialogTitle>Edit Tags</DialogTitle>
              <DialogDescription>
                Pick from popular tags or add a new one.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-disabled)]">
                Tag name
              </label>
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  ref={tagInputRef}
                  value={newTag}
                  onChange={(e) => {
                    setTagDialogError(null);
                    setNewTag(e.target.value.toLowerCase());
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.stopPropagation();
                      handleAddDialogTag();
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      closeTagDialog();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    handleAddDialogTag();
                  }}
                >
                  Add
                </Button>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-disabled)]">
                  Most used tags
                </p>
                {popularTagsLoading ? (
                  <p className="text-xs italic text-[var(--color-text-disabled)]">Loading tags…</p>
                ) : null}
                <div className="max-h-40 overflow-y-auto rounded-md border border-[var(--color-border-subtle)] p-2">
                  {tagDialogPills.length === 0 ? (
                    <p className="text-xs italic text-[var(--color-text-disabled)]">No tags available yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {tagDialogPills.map((tag) => {
                        const isSelected = tagDialogTags.includes(tag);
                        return (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => {
                              handleToggleDialogTag(tag);
                            }}
                            className={cn(
                              'inline-flex min-h-[28px] items-center rounded-full border px-3 py-1 text-sm transition-colors',
                              isSelected
                                ? 'border-[var(--color-border-strong)] bg-[var(--color-accent)]/20 text-[var(--color-text-primary)]'
                                : 'border-[var(--color-border-subtle)] bg-[var(--color-surface-control)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-hover)]',
                            )}
                          >
                            <span className="ui-tag-text">#{tag}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              {tagDialogError ? (
                <Alert variant="destructive" className="py-2 text-xs">
                  {tagDialogError}
                </Alert>
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeTagDialog}>Cancel</Button>
              <Button
                onClick={() => {
                  handleSaveTagDialog();
                }}
              >
                Save Tags
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={!!pendingNavigation} onOpenChange={(open) => { if (!open) { setPendingNavigation(null); setNavigationDialogError(null); } }}>
        {pendingNavigation ? (
          <DialogContent className="max-w-sm" aria-label="Unsaved Changes">
            <DialogHeader>
              <DialogTitle>Unsaved Changes</DialogTitle>
              <DialogDescription>
                You have unsaved changes. Save before opening the linked object?
              </DialogDescription>
            </DialogHeader>
            {navigationDialogError ? (
              <Alert variant="destructive" className="py-2 text-xs">
                {navigationDialogError}
              </Alert>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => { setPendingNavigation(null); setNavigationDialogError(null); }}>Cancel</Button>
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

    </div>
  );
}
