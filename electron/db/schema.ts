export const schema = `
  CREATE TABLE IF NOT EXISTS topic_notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '{}',
    content_markdown TEXT NOT NULL DEFAULT '',
    linked_object_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS daily_notes (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL DEFAULT '{}',
    content_markdown TEXT NOT NULL DEFAULT '',
    linked_object_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    dropbox_path TEXT NOT NULL DEFAULT '',
    start_date TEXT,
    end_date TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ref_materials (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    dropbox_path TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS habits (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS object_tags (
    object_id TEXT NOT NULL,
    object_type TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (object_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS object_links (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    target_type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(source_id, target_id)
  );

  CREATE INDEX IF NOT EXISTS idx_daily_notes_date ON daily_notes(date);
  CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
  CREATE INDEX IF NOT EXISTS idx_object_tags_object ON object_tags(object_id);
  CREATE INDEX IF NOT EXISTS idx_object_tags_tag ON object_tags(tag_id);
  CREATE INDEX IF NOT EXISTS idx_object_links_source ON object_links(source_id);
  CREATE INDEX IF NOT EXISTS idx_object_links_target ON object_links(target_id);
  CREATE INDEX IF NOT EXISTS idx_habits_date ON habits(date);
  CREATE INDEX IF NOT EXISTS idx_topic_notes_title ON topic_notes(title);
`;
