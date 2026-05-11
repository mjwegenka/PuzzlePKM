/**
 * Dropbox note sync helpers.
 *
 * DEC-25: Daily notes are stored at {rootFolder}/daily-notes/YYYY-MM-DD.md
 * DEC-26: Topic notes are stored at {rootFolder}/topic-notes/{slug}-{shortId}.md
 * DEC-27: All note metadata is stored as YAML front matter; body is Markdown.
 */

export const DEFAULT_NOTES_ROOT = '/Dropith';
const DAILY_NOTES_SUBFOLDER = 'daily-notes';
const TOPIC_NOTES_SUBFOLDER = 'topic-notes';

// ── Path helpers ──────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'untitled';
}

export function dailyNoteDropboxPath(rootFolder: string, date: string): string {
  const root = (rootFolder || DEFAULT_NOTES_ROOT).replace(/\/$/, '');
  return `${root}/${DAILY_NOTES_SUBFOLDER}/${date}.md`;
}

export function topicNoteDropboxPath(rootFolder: string, title: string, id: string): string {
  const root = (rootFolder || DEFAULT_NOTES_ROOT).replace(/\/$/, '');
  const slug = slugify(title || 'untitled');
  const shortId = id.slice(0, 8);
  return `${root}/${TOPIC_NOTES_SUBFOLDER}/${slug}-${shortId}.md`;
}

export function dailyNotesFolderPath(rootFolder: string): string {
  const root = (rootFolder || DEFAULT_NOTES_ROOT).replace(/\/$/, '');
  return `${root}/${DAILY_NOTES_SUBFOLDER}`;
}

export function topicNotesFolderPath(rootFolder: string): string {
  const root = (rootFolder || DEFAULT_NOTES_ROOT).replace(/\/$/, '');
  return `${root}/${TOPIC_NOTES_SUBFOLDER}`;
}

// ── YAML front matter ─────────────────────────────────────────────────────────

function yamlStringArray(values: string[]): string {
  if (values.length === 0) return '[]';
  return `[${values.map((v) => JSON.stringify(v)).join(', ')}]`;
}

export function serializeFrontMatter(data: Record<string, unknown>): string {
  const lines: string[] = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: ${yamlStringArray(value as string[])}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(String(value))}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

export function parseFrontMatter(content: string): { data: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content.trimStart());
  if (!match) return { data: {}, body: content };

  const yamlBlock = match[1];
  const body = match[2].replace(/^\n+/, '');
  const data: Record<string, unknown> = {};

  for (const line of yamlBlock.split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx < 1) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();

    // Use JSON.parse for both arrays and quoted strings — the serializer always
    // produces valid JSON tokens so this is safe and handles escape sequences
    // correctly (e.g. quotes inside strings, commas inside array elements).
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      try {
        const parsed = JSON.parse(rawValue);
        data[key] = Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        data[key] = [];
      }
    } else if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
      try {
        data[key] = JSON.parse(rawValue) as string;
      } catch {
        data[key] = rawValue.slice(1, -1);
      }
    } else {
      data[key] = rawValue;
    }
  }

  return { data, body };
}

// ── Note serialization ────────────────────────────────────────────────────────

export interface DailyNoteSyncFields {
  id: string;
  date: string;
  contentMarkdown: string;
  tagNames: string[];
  linkedObjectIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TopicNoteSyncFields {
  id: string;
  title: string;
  contentMarkdown: string;
  tagNames: string[];
  linkedObjectIds: string[];
  createdAt: string;
  updatedAt: string;
}

export function dailyNoteToMarkdown(fields: DailyNoteSyncFields): string {
  const fm = serializeFrontMatter({
    id: fields.id,
    type: 'daily-note',
    date: fields.date,
    tags: fields.tagNames,
    linkedObjectIds: fields.linkedObjectIds,
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt,
  });
  return fields.contentMarkdown ? `${fm}\n\n${fields.contentMarkdown}` : `${fm}\n`;
}

export function topicNoteToMarkdown(fields: TopicNoteSyncFields): string {
  const fm = serializeFrontMatter({
    id: fields.id,
    type: 'topic-note',
    title: fields.title,
    tags: fields.tagNames,
    linkedObjectIds: fields.linkedObjectIds,
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt,
  });
  return fields.contentMarkdown ? `${fm}\n\n${fields.contentMarkdown}` : `${fm}\n`;
}

export function parseDailyNoteMarkdown(content: string): DailyNoteSyncFields | null {
  const { data, body } = parseFrontMatter(content);
  if (typeof data.id !== 'string' || !data.id) return null;
  if (typeof data.date !== 'string' || !data.date) return null;
  return {
    id: data.id,
    date: data.date,
    contentMarkdown: body,
    tagNames: Array.isArray(data.tags) ? (data.tags as unknown[]).map(String) : [],
    linkedObjectIds: Array.isArray(data.linkedObjectIds)
      ? (data.linkedObjectIds as unknown[]).map(String)
      : [],
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
  };
}

export function parseTopicNoteMarkdown(content: string): TopicNoteSyncFields | null {
  const { data, body } = parseFrontMatter(content);
  if (typeof data.id !== 'string' || !data.id) return null;
  if (typeof data.title !== 'string') return null;
  return {
    id: data.id,
    title: data.title,
    contentMarkdown: body,
    tagNames: Array.isArray(data.tags) ? (data.tags as unknown[]).map(String) : [],
    linkedObjectIds: Array.isArray(data.linkedObjectIds)
      ? (data.linkedObjectIds as unknown[]).map(String)
      : [],
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
  };
}

// ── Dropbox API helpers ───────────────────────────────────────────────────────

export async function dropboxUploadText(token: string, path: string, content: string): Promise<void> {
  const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({
        path,
        mode: 'overwrite',
        autorename: false,
        mute: true,
      }),
    },
    body: content,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Dropbox upload failed (${response.status}): ${detail || response.statusText}`);
  }
}

export async function dropboxDownloadText(token: string, path: string): Promise<string | null> {
  const response = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Dropbox-API-Arg': JSON.stringify({ path }),
    },
  });
  if (response.status === 409) return null; // path/not_found or not_file
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Dropbox download failed (${response.status}): ${detail || response.statusText}`);
  }
  return response.text();
}

export async function dropboxEnsureFolder(token: string, path: string): Promise<void> {
  const response = await fetch('https://api.dropboxapi.com/2/files/create_folder_v2', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path, autorename: false }),
  });
  if (!response.ok && response.status !== 409) {
    const detail = await response.text().catch(() => '');
    // Dropbox returns 409 with "path/conflict/folder" when folder already exists
    if (!detail.includes('path/conflict/folder') && !detail.includes('path/conflict')) {
      throw new Error(`Dropbox create_folder failed (${response.status}): ${detail || response.statusText}`);
    }
  }
}

export async function dropboxListMdFiles(
  token: string,
  folderPath: string,
): Promise<Array<{ name: string; path: string }>> {
  const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path: folderPath }),
  });
  if (response.status === 409) return []; // folder not found
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Dropbox list_folder failed (${response.status}): ${detail || response.statusText}`);
  }
  const raw = await response.json() as {
    entries: Array<{ '.tag': string; name: string; path_display: string }>;
  };
  return raw.entries
    .filter((e) => e['.tag'] === 'file' && e.name.endsWith('.md'))
    .map((e) => ({ name: e.name, path: e.path_display }));
}

// ── High-level sync helpers ───────────────────────────────────────────────────

/** Fetch a single daily note from Dropbox by date. Returns null if not found. */
export async function fetchDailyNoteFromDropbox(
  date: string,
  token: string,
  rootFolder: string,
): Promise<DailyNoteSyncFields | null> {
  const path = dailyNoteDropboxPath(rootFolder, date);
  const content = await dropboxDownloadText(token, path);
  if (!content) return null;
  return parseDailyNoteMarkdown(content);
}

/** Upload a daily note to Dropbox (creates folders as needed). */
export async function pushDailyNoteToDropbox(
  fields: DailyNoteSyncFields,
  token: string,
  rootFolder: string,
): Promise<void> {
  await dropboxEnsureFolder(token, dailyNotesFolderPath(rootFolder));
  const path = dailyNoteDropboxPath(rootFolder, fields.date);
  await dropboxUploadText(token, path, dailyNoteToMarkdown(fields));
}

/** Upload a topic note to Dropbox (creates folders as needed). */
export async function pushTopicNoteToDropbox(
  fields: TopicNoteSyncFields,
  token: string,
  rootFolder: string,
): Promise<void> {
  await dropboxEnsureFolder(token, topicNotesFolderPath(rootFolder));
  const path = topicNoteDropboxPath(rootFolder, fields.title, fields.id);
  await dropboxUploadText(token, path, topicNoteToMarkdown(fields));
}

/** Download and parse all daily note Markdown files from Dropbox. */
export async function fetchAllDailyNotesFromDropbox(
  token: string,
  rootFolder: string,
): Promise<DailyNoteSyncFields[]> {
  const files = await dropboxListMdFiles(token, dailyNotesFolderPath(rootFolder));
  const settled = await Promise.allSettled(
    files.map(async (f) => {
      const content = await dropboxDownloadText(token, f.path);
      return content ? parseDailyNoteMarkdown(content) : null;
    }),
  );
  return settled
    .filter(
      (r): r is PromiseFulfilledResult<DailyNoteSyncFields> =>
        r.status === 'fulfilled' && r.value !== null,
    )
    .map((r) => r.value);
}

/** Download and parse all topic note Markdown files from Dropbox. */
export async function fetchAllTopicNotesFromDropbox(
  token: string,
  rootFolder: string,
): Promise<TopicNoteSyncFields[]> {
  const files = await dropboxListMdFiles(token, topicNotesFolderPath(rootFolder));
  const settled = await Promise.allSettled(
    files.map(async (f) => {
      const content = await dropboxDownloadText(token, f.path);
      return content ? parseTopicNoteMarkdown(content) : null;
    }),
  );
  return settled
    .filter(
      (r): r is PromiseFulfilledResult<TopicNoteSyncFields> =>
        r.status === 'fulfilled' && r.value !== null,
    )
    .map((r) => r.value);
}
