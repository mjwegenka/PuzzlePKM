/* eslint-env node */

/**
 * One-off cleanup: rewrite each note file's serialized `linkedObjectIds` to the
 * list the database actually derives from that note's content.
 *
 * Files drift out of step when a linked object is deleted: the file keeps naming
 * it, while the database — which derives links from content (DEC-69) — has long
 * since dropped it. Sync used to re-import those files on every pass because of
 * it; that comparison is gone, so the stale entries are now inert, and this
 * clears them so the files say what is true.
 *
 * Only the `linkedObjectIds` line changes. `updatedAt` is deliberately left
 * alone: the file and the database agree on everything else, so touching it
 * would make sync re-import the note for no reason.
 *
 * Dry run by default, matching `migrate-links`; pass --apply to write.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { mcpInternals } from '../cli/app.mjs';

const { withDb, getSyncRootFolder, getTopicNote, getDailyNote, listTopicNotes, listDailyNotes } = mcpInternals;

const apply = process.argv.includes('--apply');

const LINKED_LINE = /^linkedObjectIds:\s*(\[.*\])\s*$/m;
const frontMatterOf = (raw) => raw.split('\n---')[0] ?? '';
const idOf = (raw) => (/^id:\s*"?(.*?)"?\s*$/m.exec(frontMatterOf(raw)) ?? [])[1] ?? '';

/** Matches `yamlStringArray` in cli/app.mjs, so the line reads as the app would write it. */
const serializeIds = (ids) => (ids.length === 0 ? '[]' : `[${ids.map((id) => JSON.stringify(id)).join(', ')}]`);

function main() {
  const root = getSyncRootFolder();
  const changes = withDb((db) => {
    const liveIds = new Set();
    for (const table of ['topic_notes', 'daily_notes', 'projects', 'ref_materials', 'habits', 'scriptures']) {
      for (const row of db.prepare(`SELECT id FROM ${table}`).all()) liveIds.add(row.id);
    }

    const found = [];
    for (const [subfolder, get] of [['topic-notes', getTopicNote], ['daily-notes', getDailyNote]]) {
      const dir = join(root, subfolder);
      let names = [];
      try {
        names = readdirSync(dir).filter((name) => name.endsWith('.md'));
      } catch {
        continue; // Folder may not exist in a given knowledge base.
      }

      for (const name of names) {
        const path = join(dir, name);
        const raw = readFileSync(path, 'utf8');
        const match = LINKED_LINE.exec(frontMatterOf(raw));
        if (!match) continue;

        let fileIds = [];
        try {
          fileIds = JSON.parse(match[1]);
        } catch {
          continue; // Leave a line we cannot parse rather than guess at it.
        }
        if (!Array.isArray(fileIds)) continue;

        const id = idOf(raw);
        const note = id ? get(db, id) : null;
        if (!note) continue;

        const derived = Array.isArray(note.linkedObjectIds) ? note.linkedObjectIds : [];
        if (JSON.stringify(fileIds) === JSON.stringify(derived)) continue;

        found.push({
          path,
          name,
          title: note.title ?? note.date ?? id,
          removed: fileIds.filter((x) => !derived.includes(x)),
          dangling: fileIds.filter((x) => !liveIds.has(x)),
          added: derived.filter((x) => !fileIds.includes(x)),
          next: raw.replace(LINKED_LINE, `linkedObjectIds: ${serializeIds(derived)}`),
        });
      }
    }
    return found;
  });

  console.log(`${apply ? 'Rewrote' : 'Would rewrite'} linkedObjectIds in ${changes.length} file(s).`);
  console.log();
  for (const change of changes) {
    console.log(`  ${change.name}`);
    console.log(`      note: ${change.title}`);
    if (change.removed.length) {
      const dangling = change.removed.filter((x) => change.dangling.includes(x)).length;
      console.log(`      dropping ${change.removed.length} id(s)${dangling ? ` — ${dangling} naming a deleted object` : ''}: ${change.removed.join(', ')}`);
    }
    if (change.added.length) console.log(`      adding ${change.added.length} derived id(s): ${change.added.join(', ')}`);
  }

  if (apply) {
    for (const change of changes) writeFileSync(change.path, change.next, 'utf8');
  } else if (changes.length) {
    console.log();
    console.log('Dry run — nothing was written. Re-run with --apply to scrub.');
  }
}

main();
