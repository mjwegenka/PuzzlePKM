import type {
  TopicNote, DailyNote, Project, ReferenceMaterial, Habit, Tag, Link,
  DropboxAuthState, DropboxConfigState, SyncStatus, IpcResult, SearchResult, DropboxEntry, TaggedObjectResult,
} from '../shared/types'

interface DropithAPI {
  topicNote: {
    list: () => Promise<IpcResult<TopicNote[]>>
    get: (id: string) => Promise<IpcResult<TopicNote>>
    create: (input: unknown) => Promise<IpcResult<TopicNote>>
    update: (id: string, input: unknown) => Promise<IpcResult<TopicNote>>
    delete: (id: string) => Promise<IpcResult<boolean>>
  }
  dailyNote: {
    list: () => Promise<IpcResult<DailyNote[]>>
    get: (id: string) => Promise<IpcResult<DailyNote>>
    getByDate: (date: string) => Promise<IpcResult<DailyNote>>
    upsert: (input: unknown) => Promise<IpcResult<DailyNote>>
    delete: (id: string) => Promise<IpcResult<boolean>>
  }
  project: {
    list: () => Promise<IpcResult<Project[]>>
    get: (id: string) => Promise<IpcResult<Project>>
    create: (input: unknown) => Promise<IpcResult<Project>>
    update: (id: string, input: unknown) => Promise<IpcResult<Project>>
    delete: (id: string) => Promise<IpcResult<boolean>>
    browse: (path?: string) => Promise<IpcResult<DropboxEntry[]>>
    openPath: (path: string, type: 'file' | 'folder') => Promise<IpcResult<boolean>>
  }
  refMat: {
    list: () => Promise<IpcResult<ReferenceMaterial[]>>
    get: (id: string) => Promise<IpcResult<ReferenceMaterial>>
    create: (input: unknown) => Promise<IpcResult<ReferenceMaterial>>
    update: (id: string, input: unknown) => Promise<IpcResult<ReferenceMaterial>>
    delete: (id: string) => Promise<IpcResult<boolean>>
    openPath: (path: string, type: 'file' | 'folder') => Promise<IpcResult<boolean>>
  }
  habit: {
    list: (date?: string) => Promise<IpcResult<Habit[]>>
    get: (id: string) => Promise<IpcResult<Habit>>
    create: (input: unknown) => Promise<IpcResult<{ habit: Habit; truncated: boolean }>>
    update: (id: string, input: unknown) => Promise<IpcResult<{ habit: Habit | null; truncated: boolean }>>
    delete: (id: string) => Promise<IpcResult<boolean>>
  }
  tag: {
    list: () => Promise<IpcResult<Tag[]>>
    get: (id: string) => Promise<IpcResult<Tag>>
    getObjects: (id: string) => Promise<IpcResult<TaggedObjectResult[]>>
    create: (input: unknown) => Promise<IpcResult<Tag>>
    update: (id: string, input: unknown) => Promise<IpcResult<Tag>>
    delete: (id: string) => Promise<IpcResult<boolean>>
  }
  link: {
    getForObject: (objectId: string) => Promise<IpcResult<Link[]>>
    create: (input: unknown) => Promise<IpcResult<Link>>
    delete: (id: string) => Promise<IpcResult<boolean>>
  }
  search: (query: string) => Promise<IpcResult<SearchResult[]>>
  auth: {
    getState: () => Promise<IpcResult<DropboxAuthState>>
    getConfig: () => Promise<IpcResult<DropboxConfigState>>
    setConfig: (appKey: string, appSecret: string) => Promise<IpcResult<DropboxConfigState>>
    clearConfig: () => Promise<IpcResult<DropboxConfigState>>
    connect: () => Promise<IpcResult<DropboxAuthState>>
    disconnect: () => Promise<IpcResult<{ isConnected: boolean }>>
  }
  sync: {
    getStatus: () => Promise<IpcResult<SyncStatus>>
    trigger: () => Promise<IpcResult<SyncStatus>>
    onStatusChanged: (cb: (status: SyncStatus) => void) => () => void
  }
  onMenuEvent: (event: string, cb: () => void) => () => void
}

declare global {
  interface Window {
    dropith: DropithAPI
  }
}
