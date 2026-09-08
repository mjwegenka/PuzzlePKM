/* eslint-env node */

/**
 * One-off migration: turn every Markdown task list in a *topic note* back into
 * a plain bullet list, leaving daily notes alone.
 *
 * Topic notes here hold reading lists and long-finished project checklists —
 * written as checkboxes for layout rather than as work to do — so the task
 * Inbox (DEC-83) filled with hundreds of items that were never tasks. Converting
 * them to bullets keeps the text and drops them from the Inbox.
 *
 * Dry run by default, matching `migrate-links`; pass --apply to write.
 *
 *   node ./scripts/convert_topic_note_tasks_to_bullets.mjs
 *   node ./scripts/convert_topic_note_tasks_to_bullets.mjs --apply
 */

import process from 'node:process';

import { mcpInternals } from '../cli/app.mjs';
import { parseTasksFromBlocks } from '../cli/tasks/index.mjs';

const { withDb, listTopicNotes, getTopicNote, updateTopicNoteRecord, getIsoNow } = mcpInternals;

const apply = process.argv.includes('--apply');
const showAll = process.argv.includes('--verbose');

/**
 * Strips the checkbox from the task lines the parser identified, leaving the
 * bullet, its indentation and its text exactly as they were.
 *
 * The lines come from `parseTasksFromBlocks` rather than a fresh regex so that
 * checkbox-looking lines inside fenced code blocks are left alone — the parser
 * already carries fence state across block boundaries.
 */
function convertBlock(block, tasksInBlock) {
  const lineIndexes = new Set(tasksInBlock.map((task) => task.lineIndex));
  if (lineIndexes.size === 0) return null;

  const lines = String(block.contentMarkdown ?? '').split(/\r?\n/);
  let changed = 0;
  for (const index of lineIndexes) {
    const line = lines[index];
    if (line === undefined) continue;
    const next = line.replace(/^(\s*[-*+]\s+)\[[ xX]\]\s*/, '$1');
    if (next !== line) {
      lines[index] = next;
      changed += 1;
    }
  }
  return changed > 0 ? { contentMarkdown: lines.join('\n'), changed } : null;
}

function main() {
  const report = withDb((db) => {
    const notes = listTopicNotes(db);
    const changes = [];
    let taskLines = 0;
    let checkedLines = 0;
    let withDueDates = 0;

    for (const summary of notes) {
      const note = getTopicNote(db, summary.id);
      if (!note?.blocks?.length) continue;

      const tasks = parseTasksFromBlocks(note.blocks);
      if (tasks.length === 0) continue;

      const tasksByBlock = new Map();
      for (const task of tasks) {
        if (!tasksByBlock.has(task.blockId)) tasksByBlock.set(task.blockId, []);
        tasksByBlock.get(task.blockId).push(task);
        if (task.done) checkedLines += 1;
        if (task.dueDate) withDueDates += 1;
      }

      const nextBlocks = [];
      let noteChanged = 0;
      for (const block of note.blocks) {
        const converted = tasksByBlock.has(block.blockId)
          ? convertBlock(block, tasksByBlock.get(block.blockId))
          : null;
        if (converted) {
          noteChanged += converted.changed;
          nextBlocks.push({ ...block, contentMarkdown: converted.contentMarkdown });
        } else {
          nextBlocks.push(block);
        }
      }

      if (noteChanged === 0) continue;
      taskLines += noteChanged;
      changes.push({ id: note.id, title: note.title, count: noteChanged, blocks: nextBlocks, sample: tasks[0] });
    }

    if (apply) {
      for (const change of changes) {
        updateTopicNoteRecord(db, change.id, { blocks: change.blocks, updatedAt: getIsoNow() });
      }
    }

    return { notes: changes, taskLines, checkedLines, withDueDates, scanned: notes.length };
  });

  console.log(`${apply ? 'Converted' : 'Would convert'} ${report.taskLines} task line(s) in ${report.notes.length} topic note(s) (of ${report.scanned} scanned).`);
  console.log(`  ${report.checkedLines} were checked, ${report.taskLines - report.checkedLines} unchecked; ${report.withDueDates} carried a due: date.`);
  console.log();

  const shown = showAll ? report.notes : report.notes.slice(0, 20);
  for (const note of shown) {
    console.log(`  ${String(note.count).padStart(3)}  ${note.title || '(untitled)'}`);
  }
  if (shown.length < report.notes.length) {
    console.log(`  … and ${report.notes.length - shown.length} more (pass --verbose to list them all)`);
  }

  if (!apply) {
    console.log();
    console.log('Dry run — nothing was written. Re-run with --apply to convert.');
  }
}

main();
