import { ipcRenderer, contextBridge } from 'electron'
import type {
  TopicNote, DailyNote, Project, ReferenceMaterial, Habit, Tag, Link,
  DropboxAuthState, DropboxConfigState, SyncStatus, IpcResult, SearchResult, DropboxEntry, TaggedObjectResult,
} from '../src/shared/types.js'
import { IPC } from '../src/shared/ipcChannels.js'

type Listener = (...args: unknown[]) => void

const dropith = {
  // ── Topic Notes ─────────────────────────────────────────────────────────
  topicNote: {
    list: (): Promise<IpcResult<TopicNote[]>> => ipcRenderer.invoke(IPC.TOPIC_NOTE_LIST),
    get: (id: string): Promise<IpcResult<TopicNote>> => ipcRenderer.invoke(IPC.TOPIC_NOTE_GET, id),
    create: (input: unknown): Promise<IpcResult<TopicNote>> => ipcRenderer.invoke(IPC.TOPIC_NOTE_CREATE, input),
    update: (id: string, input: unknown): Promise<IpcResult<TopicNote>> => ipcRenderer.invoke(IPC.TOPIC_NOTE_UPDATE, id, input),
    delete: (id: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke(IPC.TOPIC_NOTE_DELETE, id),
  },

  // ── Daily Notes ──────────────────────────────────────────────────────────
  dailyNote: {
    list: (): Promise<IpcResult<DailyNote[]>> => ipcRenderer.invoke(IPC.DAILY_NOTE_LIST),
    get: (id: string): Promise<IpcResult<DailyNote>> => ipcRenderer.invoke(IPC.DAILY_NOTE_GET, id),
    getByDate: (date: string): Promise<IpcResult<DailyNote>> => ipcRenderer.invoke(IPC.DAILY_NOTE_GET_BY_DATE, date),
    upsert: (input: unknown): Promise<IpcResult<DailyNote>> => ipcRenderer.invoke(IPC.DAILY_NOTE_UPSERT, input),
    delete: (id: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke(IPC.DAILY_NOTE_DELETE, id),
  },

  // ── Projects ─────────────────────────────────────────────────────────────
  project: {
    list: (): Promise<IpcResult<Project[]>> => ipcRenderer.invoke(IPC.PROJECT_LIST),
    get: (id: string): Promise<IpcResult<Project>> => ipcRenderer.invoke(IPC.PROJECT_GET, id),
    create: (input: unknown): Promise<IpcResult<Project>> => ipcRenderer.invoke(IPC.PROJECT_CREATE, input),
    update: (id: string, input: unknown): Promise<IpcResult<Project>> => ipcRenderer.invoke(IPC.PROJECT_UPDATE, id, input),
    delete: (id: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke(IPC.PROJECT_DELETE, id),
    browse: (path = ''): Promise<IpcResult<DropboxEntry[]>> => ipcRenderer.invoke(IPC.PROJECT_BROWSE, path),
    openPath: (path: string, type: 'file' | 'folder'): Promise<IpcResult<boolean>> => ipcRenderer.invoke(IPC.PROJECT_OPEN_FILE, path, type),
  },

  // ── Reference Materials ───────────────────────────────────────────────────
  refMat: {
    list: (): Promise<IpcResult<ReferenceMaterial[]>> => ipcRenderer.invoke(IPC.REF_MAT_LIST),
    get: (id: string): Promise<IpcResult<ReferenceMaterial>> => ipcRenderer.invoke(IPC.REF_MAT_GET, id),
    create: (input: unknown): Promise<IpcResult<ReferenceMaterial>> => ipcRenderer.invoke(IPC.REF_MAT_CREATE, input),
    update: (id: string, input: unknown): Promise<IpcResult<ReferenceMaterial>> => ipcRenderer.invoke(IPC.REF_MAT_UPDATE, id, input),
    delete: (id: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke(IPC.REF_MAT_DELETE, id),
    openPath: (path: string, type: 'file' | 'folder'): Promise<IpcResult<boolean>> => ipcRenderer.invoke(IPC.PROJECT_OPEN_FILE, path, type),
  },

  // ── Habits ────────────────────────────────────────────────────────────────
  habit: {
    list: (date?: string): Promise<IpcResult<Habit[]>> => ipcRenderer.invoke(IPC.HABIT_LIST, date),
    get: (id: string): Promise<IpcResult<Habit>> => ipcRenderer.invoke(IPC.HABIT_GET, id),
    create: (input: unknown): Promise<IpcResult<{ habit: Habit; truncated: boolean }>> => ipcRenderer.invoke(IPC.HABIT_CREATE, input),
    update: (id: string, input: unknown): Promise<IpcResult<{ habit: Habit | null; truncated: boolean }>> => ipcRenderer.invoke(IPC.HABIT_UPDATE, id, input),
    delete: (id: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke(IPC.HABIT_DELETE, id),
  },

  // ── Tags ─────────────────────────────────────────────────────────────────
  tag: {
    list: (): Promise<IpcResult<Tag[]>> => ipcRenderer.invoke(IPC.TAG_LIST),
    get: (id: string): Promise<IpcResult<Tag>> => ipcRenderer.invoke(IPC.TAG_GET, id),
    getObjects: (id: string): Promise<IpcResult<TaggedObjectResult[]>> => ipcRenderer.invoke(IPC.TAG_GET_OBJECTS, id),
    create: (input: unknown): Promise<IpcResult<Tag>> => ipcRenderer.invoke(IPC.TAG_CREATE, input),
    update: (id: string, input: unknown): Promise<IpcResult<Tag>> => ipcRenderer.invoke(IPC.TAG_UPDATE, id, input),
    delete: (id: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke(IPC.TAG_DELETE, id),
  },

  // ── Links ─────────────────────────────────────────────────────────────────
  link: {
    getForObject: (objectId: string): Promise<IpcResult<Link[]>> => ipcRenderer.invoke(IPC.LINK_GET_FOR_OBJECT, objectId),
    create: (input: unknown): Promise<IpcResult<Link>> => ipcRenderer.invoke(IPC.LINK_CREATE, input),
    delete: (id: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke(IPC.LINK_DELETE, id),
  },

  // ── Search ────────────────────────────────────────────────────────────────
  search: (query: string): Promise<IpcResult<SearchResult[]>> => ipcRenderer.invoke(IPC.SEARCH_ALL, query),

  // ── Auth ──────────────────────────────────────────────────────────────────
  auth: {
    getState: (): Promise<IpcResult<DropboxAuthState>> => ipcRenderer.invoke(IPC.AUTH_GET_STATE),
    getConfig: (): Promise<IpcResult<DropboxConfigState>> => ipcRenderer.invoke(IPC.AUTH_GET_CONFIG),
    setConfig: (appKey: string, appSecret: string): Promise<IpcResult<DropboxConfigState>> => ipcRenderer.invoke(IPC.AUTH_SET_CONFIG, appKey, appSecret),
    clearConfig: (): Promise<IpcResult<DropboxConfigState>> => ipcRenderer.invoke(IPC.AUTH_CLEAR_CONFIG),
    connect: (): Promise<IpcResult<DropboxAuthState>> => ipcRenderer.invoke(IPC.AUTH_CONNECT_DROPBOX),
    disconnect: (): Promise<IpcResult<{ isConnected: boolean }>> => ipcRenderer.invoke(IPC.AUTH_DISCONNECT_DROPBOX),
  },

  // ── Sync ──────────────────────────────────────────────────────────────────
  sync: {
    getStatus: (): Promise<IpcResult<SyncStatus>> => ipcRenderer.invoke(IPC.SYNC_GET_STATUS),
    trigger: (): Promise<IpcResult<SyncStatus>> => ipcRenderer.invoke(IPC.SYNC_TRIGGER),
    onStatusChanged: (cb: (status: SyncStatus) => void): (() => void) => {
      const listener: Listener = (_e, status) => cb(status as SyncStatus)
      ipcRenderer.on(IPC.SYNC_STATUS_CHANGED, listener)
      return () => ipcRenderer.off(IPC.SYNC_STATUS_CHANGED, listener)
    },
  },

  // ── Menu events ───────────────────────────────────────────────────────────
  onMenuEvent: (event: string, cb: () => void): (() => void) => {
    const listener: Listener = () => cb()
    ipcRenderer.on(event, listener)
    return () => ipcRenderer.off(event, listener)
  },
}

contextBridge.exposeInMainWorld('dropith', dropith)

