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
import type { MentionOption } from './MentionPopup';
import RichMarkdownEditor from './RichMarkdownEditor';
import { resolveObjectFromLinkPath, writeObject, type ResolvedObjectRef } from '../lib/cliService';
import { getTodayDate } from '../lib/dateUtils';
import { useSyncStatus } from '../lib/syncContext';

interface ObjectEditorProps {
  object?: Record<string, unknown>;
  type: 'topic-note' | 'daily-note' | 'project' | 'ref-material' | 'habit';
  onSave?: (saved: Record<string, unknown>) => void;
  onCancel?: () => void;
  onDirty?: (isDirty: boolean) => void;
  onNavigateToObject?: (target: ResolvedObjectRef) => void | Promise<void>;
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
  const currentPath = normalizeDropboxPath(object?.dropboxPath as string | undefined);
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

export default function ObjectEditor({ object, type, onSave, onCancel, onDirty, onNavigateToObject }: ObjectEditorProps) {
  const { triggerSync } = useSyncStatus();
  const defaultDate =
    type === 'daily-note' || type === 'topic-note' || type === 'habit' ? getTodayDate() : '';

  const initialRef = useRef<{ title: string; date: string; content: string; tags: string[] }>({
    title: '',
    date: defaultDate,
    content: '',
    tags: [],
  });

  const [title, setTitle] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [showTagDialog, setShowTagDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<ResolvedObjectRef | null>(null);

  // Reset form when a different object payload is loaded.
  useEffect(() => {
    const nextTitle = (object?.title as string) || (object?.name as string) || '';
    const nextDate = (object?.date as string) || (object?.startDate as string) || defaultDate;
    const nextContent =
      (type === 'habit' ? (object?.text as string) : (object?.contentMarkdown as string)) || '';
    const nextTags = (object?.tags as string[]) || [];

    initialRef.current = {
      title: nextTitle,
      date: nextDate,
      content: nextContent,
      tags: [...nextTags],
    };

    setTitle(nextTitle);
    setDate(nextDate);
    setContent(nextContent);
    setTags(nextTags);
    setSaveError(null);
    setIsDirty(false);
    setPendingNavigation(null);
    onDirty?.(false);
  }, [object, defaultDate, type, onDirty]);

  const resolveMentionHref = useCallback(
    (option: MentionOption) => {
      const targetPath = normalizeDropboxPath(option.dropboxPath);
      const currentSourceDir = inferCurrentSourceDir(type, object, title, date);
      return targetPath && currentSourceDir
        ? relativeDropboxPath(currentSourceDir, targetPath)
        : targetPath || option.id;
    },
    [date, object, title, type],
  );

  const handleAddTag = () => {
    const tag = newTag.trim().toLowerCase();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
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
        data.linkedObjectIds = (object?.linkedObjectIds as string[]) ?? [];
      } else if (type === 'daily-note') {
        data.date = date;
        data.contentMarkdown = content;
        data.linkedObjectIds = (object?.linkedObjectIds as string[]) ?? [];
      } else if (type === 'project') {
        data.name = title;
        data.startDate = date || undefined;
        data.dropboxPath = (object?.dropboxPath as string) ?? '';
      } else if (type === 'ref-material') {
        data.name = title;
        data.dropboxPath = (object?.dropboxPath as string) ?? '';
      } else if (type === 'habit') {
        data.text = content;
        data.date = date;
      }

      const saved = await writeObject(type, data);
      initialRef.current = {
        title,
        date,
        content,
        tags: [...tags],
      };
      setIsDirty(false);
      onDirty?.(false);
      // DEC-19: trigger sync after every successful save
      triggerSync();
      return saved;
    } catch (err) {
      setSaveError(String(err));
      throw err;
    } finally {
      setSaving(false);
    }
  }, [content, date, object?.dropboxPath, object?.id, object?.linkedObjectIds, onDirty, tags, title, triggerSync, type]);

  const handleSave = async () => {
    try {
      const saved = await persistCurrentObject();
      onSave?.(saved);
    } catch {
      // Error already set in state by persistCurrentObject
    }
  };

  const executeNavigation = useCallback(async (target: ResolvedObjectRef) => {
    if (!onNavigateToObject) return;
    await onNavigateToObject(target);
  }, [onNavigateToObject]);

  const handleShiftClickLink = useCallback(async (href: string) => {
    if (!onNavigateToObject) return;
    const currentPath = normalizeDropboxPath(object?.dropboxPath as string | undefined);
    const target = await resolveObjectFromLinkPath(href, currentPath);

    if (!target) {
      setSaveError(`Could not resolve linked object: ${href}`);
      return;
    }

    if (isDirty) {
      setPendingNavigation(target);
      return;
    }

    await executeNavigation(target);
  }, [executeNavigation, isDirty, object?.dropboxPath, onNavigateToObject]);

  const handleDiscardAndNavigate = async () => {
    if (!pendingNavigation) return;
    setPendingNavigation(null);
    setIsDirty(false);
    onDirty?.(false);
    await executeNavigation(pendingNavigation);
  };

  const handleSaveAndNavigate = async () => {
    if (!pendingNavigation) return;
    try {
      await persistCurrentObject();
      await executeNavigation(pendingNavigation);
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
      date !== baseline.date ||
      content !== baseline.content ||
      JSON.stringify(tags) !== JSON.stringify(baseline.tags);
    setIsDirty(isDirty);
    onDirty?.(isDirty);
  }, [title, date, content, tags, onDirty]);

  const isNoteType = type === 'topic-note' || type === 'daily-note';
  const showTitle = type !== 'daily-note' && type !== 'habit';
  const showDate = type === 'daily-note' || type === 'topic-note' || type === 'project' || type === 'habit';
  const showContent = type !== 'project' && type !== 'ref-material';

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
              {date ? `Daily Note — ${date}` : 'Daily Note'}
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

          {showDate && (
            <TextField
              fullWidth
              label={type === 'project' ? 'Start Date' : 'Date'}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              variant="standard"
              placeholder="YYYY-MM-DD"
              sx={{ mb: 1.5 }}
            />
          )}
        </Box>

        {/* ── MIDDLE: Main content (fills remaining space) ── */}
        {showContent && (
          <Box sx={{ flex: 1, minHeight: 0, position: 'relative', mb: 2, display: 'flex', overflow: 'hidden' }}>
            <RichMarkdownEditor
              label={type === 'habit' ? 'Habit text' : 'Content'}
              value={content}
              onChange={setContent}
              placeholder={
                isNoteType
                  ? 'Write your note… type @ to link another object'
                  : 'Any notes…'
              }
              mentionEnabled={isNoteType}
              resolveMentionHref={resolveMentionHref}
              maxLength={type === 'habit' ? 255 : undefined}
              onShiftClickLink={onNavigateToObject ? handleShiftClickLink : undefined}
            />
          </Box>
        )}

        {/* ── BOTTOM: Tags (always last) ── */}
        <Box sx={{ borderTop: '1px solid #1c3558', pt: 2, flexShrink: 0, minHeight: 0 }}>
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
    </Paper>
  );
}

