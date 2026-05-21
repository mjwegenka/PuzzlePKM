export type ObjectType = 'topic-note' | 'daily-note' | 'project' | 'ref-material' | 'habit' | 'tag';

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
  syncPath?: string;
  dropboxPath: string;
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
}

export interface ReferenceMaterial extends BaseObject {
  type: 'ref-material';
  name: string;
  author?: string;
  syncPath?: string;
  dropboxPath: string;
}

export interface Habit extends BaseObject {
  type: 'habit';
  text: string; // < 256 chars
  date: string; // YYYY-MM-DD
  status: 'planned' | 'accomplished';
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

export interface DropboxAuthState {
  isConnected: boolean;
  isConfigured: boolean;
  accountEmail?: string;
  rootFolder?: string;
}

export interface DropboxConfigState {
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

export type AnyObject = TopicNote | DailyNote | Project | ReferenceMaterial | Habit;

export interface SearchResult {
  id: string;
  type: ObjectType;
  title: string;
  snippet?: string;
}

export interface DropboxEntry {
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
