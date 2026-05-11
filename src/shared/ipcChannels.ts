export const IPC = {
  // Topic Notes
  TOPIC_NOTE_LIST: 'topic-note:list',
  TOPIC_NOTE_GET: 'topic-note:get',
  TOPIC_NOTE_CREATE: 'topic-note:create',
  TOPIC_NOTE_UPDATE: 'topic-note:update',
  TOPIC_NOTE_DELETE: 'topic-note:delete',
  // Daily Notes
  DAILY_NOTE_LIST: 'daily-note:list',
  DAILY_NOTE_GET: 'daily-note:get',
  DAILY_NOTE_GET_BY_DATE: 'daily-note:get-by-date',
  DAILY_NOTE_UPSERT: 'daily-note:upsert',
  DAILY_NOTE_DELETE: 'daily-note:delete',
  // Projects
  PROJECT_LIST: 'project:list',
  PROJECT_GET: 'project:get',
  PROJECT_CREATE: 'project:create',
  PROJECT_UPDATE: 'project:update',
  PROJECT_DELETE: 'project:delete',
  PROJECT_BROWSE: 'project:browse',
  PROJECT_OPEN_FILE: 'project:open-file',
  // Reference Materials
  REF_MAT_LIST: 'ref-mat:list',
  REF_MAT_GET: 'ref-mat:get',
  REF_MAT_CREATE: 'ref-mat:create',
  REF_MAT_UPDATE: 'ref-mat:update',
  REF_MAT_DELETE: 'ref-mat:delete',
  // Habits
  HABIT_LIST: 'habit:list',
  HABIT_GET: 'habit:get',
  HABIT_CREATE: 'habit:create',
  HABIT_UPDATE: 'habit:update',
  HABIT_DELETE: 'habit:delete',
  // Tags
  TAG_LIST: 'tag:list',
  TAG_GET: 'tag:get',
  TAG_GET_OBJECTS: 'tag:get-objects',
  TAG_CREATE: 'tag:create',
  TAG_UPDATE: 'tag:update',
  TAG_DELETE: 'tag:delete',
  // Links
  LINK_GET_FOR_OBJECT: 'link:get-for-object',
  LINK_CREATE: 'link:create',
  LINK_DELETE: 'link:delete',
  // Search
  SEARCH_ALL: 'search:all',
  // Auth
  AUTH_GET_CONFIG: 'auth:get-config',
  AUTH_SET_CONFIG: 'auth:set-config',
  AUTH_CLEAR_CONFIG: 'auth:clear-config',
  AUTH_CONNECT_DROPBOX: 'auth:connect-dropbox',
  AUTH_DISCONNECT_DROPBOX: 'auth:disconnect-dropbox',
  AUTH_GET_STATE: 'auth:get-state',
  // Sync
  SYNC_TRIGGER: 'sync:trigger',
  SYNC_GET_STATUS: 'sync:get-status',
  SYNC_STATUS_CHANGED: 'sync:status-changed',
} as const;
