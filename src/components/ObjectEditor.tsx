import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Box,
  Paper,
  Stack,
  TextField,
  Typography,
  Button,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  Alert,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SaveIcon from '@mui/icons-material/Save';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { DatePicker as MUIDatePicker } from '@mui/x-date-pickers/DatePicker';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { format, isValid, parseISO } from 'date-fns';
import type { MentionOption } from './MentionPopup';
import RichMarkdownEditor from './RichMarkdownEditor';
import { deleteObject, getObject, resolveObjectFromLinkPath, writeObject, type ResolvedObjectRef } from '../lib/cliService';
import { formatDatePretty, getTodayDate } from '../lib/dateUtils';
import { useSyncStatus } from '../lib/syncContext';
import type { NoteBlock } from '../shared/types';

interface ObjectEditorProps {
  object?: Record<string, unknown>;
  type: 'topic-note' | 'daily-note' | 'project' | 'ref-material' | 'habit';
  onSave?: (saved: Record<string, unknown>) => void;
  onCancel?: () => void;
  onDirty?: (isDirty: boolean) => void;
  onNavigateToObject?: (target: ResolvedObjectRef, options?: { forceNewTab?: boolean }) => void | Promise<void>;
  onDateChange?: (date: string) => void | Promise<void>;
}


function normalizeDropboxPath(path?: string): string | undefined {
  const value = (path ?? '').trim();
  return value && value !== '(no path)' ? value.replace(/\\/g, '/') : undefined;
}

function splitPath(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled';
}

function pathInsideDropboxRoot(path: string): string {
  const segments = splitPath(path);
  return segments.slice(1).join('/');
}

function dirnameInsideDropboxRoot(path: string): string {
  const insideRoot = pathInsideDropboxRoot(path);
  const segments = splitPath(insideRoot);
  return segments.slice(0, -1).join('/');
}

function inferCurrentSourceDir(
  type: ObjectEditorProps['type'],
  object: Record<string, unknown> | undefined,
  title: string,
  date: string,
): string | undefined {
  const currentPath = normalizeDropboxPath((object?.syncPath as string | undefined) ?? (object?.dropboxPath as string | undefined));
  if (currentPath) {
    if (type === 'project' || type === 'ref-material') {
      return pathInsideDropboxRoot(currentPath);
    }
    return dirnameInsideDropboxRoot(currentPath);
  }

  switch (type) {
    case 'daily-note':
      return 'daily-notes';
    case 'topic-note':
      return 'topic-notes';
    case 'habit':
      return 'habits';
    case 'project':
      return title ? `projects/${slugify(title)}` : 'projects';
    case 'ref-material':
      return title ? `ref-materials/${slugify(title)}` : 'ref-materials';
    default:
      return date ? 'daily-notes' : undefined;
  }
}

function relativeDropboxPath(fromDir: string, targetPath: string): string {
  const fromSegments = splitPath(fromDir);
  const targetSegments = splitPath(pathInsideDropboxRoot(targetPath));

  if (targetSegments.length === 0) return targetPath;

  let shared = 0;
  while (
    shared < fromSegments.length &&
    shared < targetSegments.length &&
    fromSegments[shared] === targetSegments[shared]
  ) {
    shared += 1;
  }

  const up = Array(fromSegments.length - shared).fill('..');
  const down = targetSegments.slice(shared);
  return [...up, ...down].join('/') || targetSegments[targetSegments.length - 1] || targetPath;
}

function isEffectivelyEmptyNoteContent(value: string): boolean {
  const normalized = value
    .replace(/<br\s*\/?>/gi, '')
    .replace(/&nbsp;/gi, '')
    .trim();
  return normalized.length === 0;
}

function fallbackBlockId(index: number): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(16)}${index.toString(16).padStart(2, '0')}`;
  return `blk-${random.slice(0, 12).padEnd(12, '0')}`;
}

function parseLegacyBlocksFromMarkdown(contentMarkdown: string): NoteBlock[] {
  const raw = contentMarkdown.trimEnd();
  if (!raw) return [];
  const paragraphs = raw.split(/\n{2,}/).map((p) => p.trimEnd()).filter(Boolean);
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

export default function ObjectEditor({ object, type, onSave, onCancel, onDirty, onNavigateToObject, onDateChange }: ObjectEditorProps) {
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
  const mentionTargetBlockCacheRef = useRef(new Map<string, string | null>());

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
  // onDirty intentionally excluded – it's a callback and must not trigger a
  // form reset when its reference changes (e.g. inline function in parent).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [object, defaultDate, type]);

  const resolveMentionHref = useCallback(
    async (option: MentionOption) => {
      const targetPath = normalizeDropboxPath(option.syncPath ?? option.dropboxPath);
      const currentSourceDir = inferCurrentSourceDir(type, object, title, date);
      const baseHref = targetPath && currentSourceDir
        ? relativeDropboxPath(currentSourceDir, targetPath)
        : targetPath || option.id;

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
    [date, object, title, type],
  );

  const handleAddTag = () => {
    const tag = newTag.trim().toLowerCase();
    if (tag) {
      if (type === 'habit') {
        setTags([tag]);
      } else if (!tags.includes(tag)) {
        setTags([...tags, tag]);
      }
      setNewTag('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const persistCurrentObject = useCallback(async (): Promise<Record<string, unknown>> => {
    setSaving(true);
    setSaveError(null);
    try {
      const data: Record<string, unknown> = {
        id: object?.id,
        tags,
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
        data.dropboxPath = ((object?.syncPath as string) ?? (object?.dropboxPath as string)) ?? '';
      } else if (type === 'ref-material') {
        data.name = title;
        data.author = author || '';
        data.dropboxPath = ((object?.syncPath as string) ?? (object?.dropboxPath as string)) ?? '';
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
        tags: [...tags],
      };
      setIsDirty(false);
      onDirty?.(false);
      window.dispatchEvent(new Event('dropith:objects-updated'));
      // Queue sync after save without extending the save interaction.
      triggerSyncInBackground();
      return saved;
    } catch (err) {
      setSaveError(String(err));
      throw err;
    } finally {
      setSaving(false);
    }
  }, [author, content, date, noteBlocks, object?.dropboxPath, object?.syncPath, object?.id, object?.linkedObjectIds, onDirty, tags, title, triggerSyncInBackground, type]);

  const handleSave = async () => {
    const isEmptyNoteContent =
      (type === 'topic-note' || type === 'daily-note') &&
      isEffectivelyEmptyNoteContent(content);
    const isHabitWithoutTags = type === 'habit' && tags.length === 0;

    if (isEmptyNoteContent) {
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
    if (!onNavigateToObject) return;
    try {
      const currentPath = normalizeDropboxPath(((object?.syncPath as string | undefined) ?? (object?.dropboxPath as string | undefined)));
      const target = await resolveObjectFromLinkPath(href, currentPath);

      if (!target) {
        setSaveError(`Could not resolve linked object: ${href}`);
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
  }, [executeNavigation, isDirty, object?.dropboxPath, object?.syncPath, onNavigateToObject]);

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
  // onDirty intentionally excluded – see onDirtyRef above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, author, date, content, tags]);

  useEffect(() => {
    if (type !== 'daily-note' || !onDateChange) return;
    void onDateChange(date);
  }, [date, onDateChange, type]);

  const isNoteType = type === 'topic-note' || type === 'daily-note';
  const forwardLinks = isNoteType && Array.isArray(object?.links)
    ? (object.links as Array<Record<string, unknown>>)
    : [];
  const backlinkLinks = isNoteType && Array.isArray(object?.backlinks)
    ? (object.backlinks as Array<Record<string, unknown>>)
    : [];
  const relationLabel = (relation: Record<string, unknown>) => {
    const rawTitle = String(relation.title ?? '').trim();
    const rawDate = String(relation.date ?? '').trim();
    const relationType = String(relation.type ?? '').trim();
    if (relationType === 'daily-note' && rawDate) return rawDate;
    if (rawTitle) return rawTitle;
    if (rawDate) return rawDate;
    return String(relation.id ?? '');
  };
  const showTitle = type !== 'daily-note' && type !== 'habit';
  const showDate = type === 'daily-note' || type === 'topic-note' || type === 'project' || type === 'habit';
  const isOptionalDate = type === 'topic-note' || type === 'project';
  const showContent = type !== 'project' && type !== 'ref-material';
  const isHabit = type === 'habit';
  const selectedDate = (() => {
    if (!date) return null;
    const parsed = parseISO(date);
    return isValid(parsed) ? parsed : null;
  })();
  const tagsEditor = (
    <>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.25 }}>
        <Typography variant="caption" sx={{ fontWeight: 700, color: '#7dbad6', letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: '10px' }}>
          Tags
        </Typography>
        <IconButton
          size="small"
          onClick={() => setShowTagDialog(true)}
          sx={{ p: 0.4, color: '#7dbad6', '&:hover': { color: '#e4f0fb' } }}
        >
          <AddIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Stack>

      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
        {tags.length === 0 && (
          <Typography variant="caption" sx={{ color: '#4a6a8a', fontStyle: 'italic' }}>
            No tags — click + to add
          </Typography>
        )}
        {tags.map((tag) => (
          <Chip
            key={tag}
            label={`#${tag}`}
            onDelete={() => handleRemoveTag(tag)}
            size="small"
            sx={{
              bgcolor: 'rgba(26,138,181,0.15)',
              border: '1px solid rgba(26,138,181,0.35)',
              color: '#b0d4e8',
              height: 22,
              '& .MuiChip-deleteIcon': { fontSize: 14, color: '#7dbad6' },
            }}
          />
        ))}
      </Stack>
    </>
  );

  return (
    <Paper
      sx={{
        p: 3,
        bgcolor: '#0e2038',
        border: '1px solid #1c3558',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <Stack sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 0, overflow: 'hidden' }}>
        {/* ── TOP: Title and Date (always first) ── */}
        <Box sx={{ mb: 2, flexShrink: 0 }}>
          {type === 'daily-note' && (
            <Typography variant="h5" sx={{ fontWeight: 700, color: '#e4f0fb', mb: 1 }}>
              {date ? `Daily Note — ${formatDatePretty(date)}` : 'Daily Note'}
            </Typography>
          )}

          {showTitle && (
            <TextField
              fullWidth
              label={type === 'topic-note' ? 'Title' : 'Name'}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              variant="standard"
              placeholder={type === 'topic-note' ? 'Note title…' : 'Name…'}
              sx={{ mb: 1.5, '& input': { fontSize: '1.15rem', fontWeight: 600 } }}
            />
          )}
          {type === 'ref-material' && (
            <TextField
              fullWidth
              label="Author (optional)"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              variant="standard"
              placeholder="Author name…"
              sx={{ mb: 1.5 }}
            />
          )}

          {isHabit && (
            <Box sx={{ mb: 1.5 }}>
              {tagsEditor}
            </Box>
          )}

          {showDate && (
            <Box sx={{ mb: 1.5 }}>
              <LocalizationProvider dateAdapter={AdapterDateFns}>
                <Stack direction="row" spacing={1} alignItems="flex-start">
                  <Box sx={{ width: { xs: '100%', sm: 260 }, maxWidth: '100%' }}>
                    <MUIDatePicker
                      label={type === 'project' ? 'Start Date' : 'Date'}
                      value={selectedDate}
                      format="MMMM d, yyyy"
                      onChange={(nextValue) => {
                        if (!nextValue || !isValid(nextValue)) {
                          setDate('');
                          return;
                        }
                        setDate(format(nextValue, 'yyyy-MM-dd'));
                      }}
                      slotProps={{
                        textField: {
                          variant: 'standard',
                          helperText: !date && isOptionalDate ? 'No date set' : undefined,
                          sx: {
                            width: '100%',
                            '& .MuiInputBase-root': {
                              pr: 0.5,
                            },
                          },
                        },
                      }}
                    />
                  </Box>
                  {isOptionalDate && date && (
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => setDate('')}
                      sx={{ mt: 1.25, minWidth: 'auto', whiteSpace: 'nowrap' }}
                    >
                      Clear
                    </Button>
                  )}
                </Stack>
              </LocalizationProvider>
            </Box>
          )}
        </Box>

        {/* ── MIDDLE: Main content (fills remaining space) ── */}
        {showContent && (
          <Box sx={{ flex: 1, minHeight: 0, position: 'relative', mb: 2, display: 'flex', overflow: 'hidden' }}>
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
              onShiftClickLink={onNavigateToObject ? handleShiftClickLink : undefined}
            />
          </Box>
        )}

        {/* ── BOTTOM: Relationships + Tags ── */}
        <Box sx={{ borderTop: '1px solid #1c3558', pt: 2, flexShrink: 0, minHeight: 0 }}>
          {isNoteType && (
            <Stack spacing={1.5} sx={{ mb: 2 }}>
              <Box>
                <Typography variant="caption" sx={{ fontWeight: 700, color: '#7dbad6', letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: '10px', display: 'block', mb: 0.75 }}>
                  Links
                </Typography>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                  {forwardLinks.length === 0 ? (
                    <Typography variant="caption" sx={{ color: '#4a6a8a', fontStyle: 'italic' }}>
                      No links
                    </Typography>
                  ) : (
                    forwardLinks.map((relation) => (
                      <Chip
                        key={`forward-${String(relation.id)}`}
                        label={relationLabel(relation)}
                        size="small"
                        sx={{
                          bgcolor: 'rgba(26,138,181,0.15)',
                          border: '1px solid rgba(26,138,181,0.35)',
                          color: '#b0d4e8',
                          height: 22,
                        }}
                      />
                    ))
                  )}
                </Stack>
              </Box>
              <Box>
                <Typography variant="caption" sx={{ fontWeight: 700, color: '#7dbad6', letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: '10px', display: 'block', mb: 0.75 }}>
                  Backlinks
                </Typography>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                  {backlinkLinks.length === 0 ? (
                    <Typography variant="caption" sx={{ color: '#4a6a8a', fontStyle: 'italic' }}>
                      No backlinks
                    </Typography>
                  ) : (
                    backlinkLinks.map((relation) => (
                      <Chip
                        key={`backlink-${String(relation.id)}`}
                        label={relationLabel(relation)}
                        size="small"
                        sx={{
                          bgcolor: 'rgba(125,207,170,0.14)',
                          border: '1px solid rgba(125,207,170,0.35)',
                          color: '#c7e7d8',
                          height: 22,
                        }}
                      />
                    ))
                  )}
                </Stack>
              </Box>
            </Stack>
          )}

          {!isHabit && tagsEditor}
        </Box>

        {/* ── Action buttons ── */}
        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 2, flexShrink: 0 }}>
          {saveError && (
            <Alert severity="error" sx={{ flex: 1, py: 0.25, fontSize: '12px' }}>
              {saveError}
            </Alert>
          )}
          {onCancel && (
            <Button variant="outlined" onClick={onCancel} disabled={saving} size="small">
              Cancel
            </Button>
          )}
          <Button
            variant="contained"
            startIcon={saving ? <CircularProgress size={14} /> : <SaveIcon />}
            onClick={handleSave}
            disabled={saving}
            size="small"
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </Stack>
      </Stack>

      {/* Tag dialog */}
      <Dialog open={showTagDialog} onClose={() => setShowTagDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Add Tag</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Tag name"
            fullWidth
            value={newTag}
            onChange={(e) => setNewTag(e.target.value.toLowerCase())}
            variant="standard"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleAddTag();
                setShowTagDialog(false);
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowTagDialog(false)}>Cancel</Button>
          <Button
            onClick={() => {
              handleAddTag();
              setShowTagDialog(false);
            }}
            variant="contained"
          >
            Add
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!pendingNavigation}
        onClose={() => setPendingNavigation(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Unsaved Changes</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: '#b0d4e8' }}>
            You have unsaved changes. Save before opening the linked object?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingNavigation(null)}>Cancel</Button>
          <Button onClick={() => { void handleDiscardAndNavigate(); }} color="error">
            Discard
          </Button>
          <Button onClick={() => { void handleSaveAndNavigate(); }} variant="contained" disabled={saving}>
            Save &amp; Open
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!pendingDeleteReason}
        onClose={() => {
          if (!saving) setPendingDeleteReason(null);
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: '#b0d4e8' }}>
            {pendingDeleteReason === 'empty-note'
              ? 'This note has empty content. Delete it instead of saving?'
              : 'This habit has no tags. Delete it instead of saving?'}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingDeleteReason(null)} disabled={saving}>Cancel</Button>
          <Button onClick={() => { void handleConfirmDeleteOnSave(); }} color="error" variant="contained" disabled={saving}>
            {saving ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
