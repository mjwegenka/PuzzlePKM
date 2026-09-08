export type ObjectType = 'topic-note' | 'daily-note' | 'project' | 'ref-material' | 'habit' | 'scripture' | 'scripture-chapter' | 'tag';

export interface BaseObject {
  id: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  tags: string[];    // tag IDs
}

export interface NoteBlock {
  blockId: string;
  position: number;
  contentMarkdown: string;
}

export interface TopicNote extends BaseObject {
  type: 'topic-note';
  title: string;
  date?: string; // optional YYYY-MM-DD
  content: object; // TipTap JSON
  contentMarkdown: string;
  blocks: NoteBlock[];
  linkedObjectIds: string[];
}

export interface DailyNote extends BaseObject {
  type: 'daily-note';
  date: string; // YYYY-MM-DD (local timezone)
  content: object; // TipTap JSON
  contentMarkdown: string;
  blocks: NoteBlock[];
  linkedObjectIds: string[];
}

export interface Project extends BaseObject {
  type: 'project';
  name: string;
  syncPath: string;
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
}

export interface ReferenceMaterial extends BaseObject {
  type: 'ref-material';
  name: string;
  author?: string;
  syncPath: string;
}

export interface Habit extends BaseObject {
  type: 'habit';
  text: string; // < 256 chars
  date: string; // YYYY-MM-DD
  status: 'planned' | 'accomplished';
}

export interface Scripture {
  id: string;
  type: 'scripture';
  reference: string;
  bookName: string;
  bookOrder: number;
  passageUrl: string;
  linkedNotes: Array<{
    id: string;
    type: 'topic-note' | 'daily-note';
    title: string;
    date?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

/**
 * DEC-77: A chapter of scripture — the unit citations are browsed by. Many
 * verse-level `Scripture` references roll up into one chapter.
 */
export interface ScriptureChapterReference {
  id: string;
  type: 'scripture';
  reference: string;
  passageUrl: string;
  /** null when the citation covers the whole chapter. */
  verseStart: number | null;
  /** null when the span runs to the end of the chapter. */
  verseEnd: number | null;
  noteCount: number;
  linkedNotes: Array<{
    id: string;
    type: 'topic-note' | 'daily-note';
    title: string;
    date?: string;
    syncPath?: string;
  }>;
}

export interface ScriptureChapterSummary {
  id: string;
  type: 'scripture-chapter';
  reference: string;
  bookName: string;
  bookOrder: number;
  chapter: number;
  passageUrl: string;
  noteCount?: number;
}

export interface ScriptureChapter extends ScriptureChapterSummary {
  /** Every verse-level citation in this chapter, ordered by verse span. */
  references: ScriptureChapterReference[];
  /** Distinct notes citing this chapter through any of those references. */
  linkedNotes: Array<{
    id: string;
    type: 'topic-note' | 'daily-note';
    title: string;
    date?: string;
    syncPath?: string;
  }>;
  adjacentChapters: {
    previous: ScriptureChapterSummary | null;
    next: ScriptureChapterSummary | null;
  };
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  name: string;       // stored lowercase
  displayName: string;
  createdAt: string;
}

export interface Link {
  id: string;
  sourceId: string;
  targetId: string;
  sourceType: ObjectType;
  targetType: ObjectType;
  createdAt: string;
}

export interface SyncAuthState {
  isConnected: boolean;
  isConfigured: boolean;
  accountEmail?: string;
  rootFolder?: string;
}

export interface SyncConfigState {
  appKeySet: boolean;
  appSecretSet: boolean;
  source: 'in-app' | 'environment' | 'mixed' | 'none';
}

export interface SyncStatus {
  lastSyncAt?: string;
  isSyncing: boolean;
  error?: string;
}

export interface IpcResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export type AnyObject = TopicNote | DailyNote | Project | ReferenceMaterial | Habit | Scripture;

export interface SearchResult {
  id: string;
  type: ObjectType;
  title: string;
  snippet?: string;
}

export interface SyncEntry {
  name: string;
  path: string;
  type: 'file' | 'folder';
}

export interface TaggedObjectResult {
  id: string;
  type: ObjectType;
  title: string;
  route: string;
}
