/**
 * Tasks are Markdown checkboxes living inside daily and topic notes (DEC-83).
 * Nothing here touches the database: the parser is the part worth testing on
 * its own, and the index built from it is derived data that can be thrown away
 * and rebuilt from the notes at any time.
 */

/** `- [ ] text`, `* [x] text`, indented or not. */
const TASK_LINE = /^(\s*)([-*+])(\s+)\[([ xX])\](\s*)(.*)$/;

/** A fence opens or closes a code block; task-looking lines inside one are prose. */
const FENCE_LINE = /^\s{0,3}(```|~~~)/;

/** `due:YYYY-MM-DD`, standing alone rather than inside a longer word. */
const DUE_TOKEN = /(^|\s)due:(\d{4}-\d{2}-\d{2})(?=\s|$)/;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value) {
  const text = String(value ?? '').trim();
  if (!ISO_DATE.test(text)) return false;
  // Rejects 2026-02-31 and friends, which match the shape but are not days.
  const parsed = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

/**
 * Splits a due date off a task's text. A malformed `due:` is left in the text
 * rather than silently swallowed — better a visible oddity than a lost date.
 */
export function extractDueDate(text) {
  const match = DUE_TOKEN.exec(String(text ?? ''));
  if (!match || !isValidIsoDate(match[2])) return { text: String(text ?? '').trim(), dueDate: null };
  const stripped = String(text).replace(DUE_TOKEN, '$1').replace(/\s{2,}/g, ' ').trim();
  return { text: stripped, dueDate: match[2] };
}

export function formatTaskLine({ indent = '', bullet = '-', done = false, text = '', dueDate = null }) {
  const body = String(text ?? '').trim();
  const due = dueDate && isValidIsoDate(dueDate) ? ` due:${dueDate}` : '';
  return `${indent}${bullet} [${done ? 'x' : ' '}] ${body}${due}`.trimEnd();
}

/**
 * Every task in one note, in reading order.
 *
 * Blocks are the note's paragraphs (DEC-38), so a fenced code block containing
 * a blank line spans several of them — fence state therefore has to carry from
 * one block to the next rather than reset per block.
 *
 * `ordinal` counts task lines within a block, which is what gives a task its
 * identity: the block id is stable across edits elsewhere in the note.
 */
export function parseTasksFromBlocks(blocks) {
  const tasks = [];
  let insideFence = false;

  for (const block of Array.isArray(blocks) ? blocks : []) {
    const blockId = String(block?.blockId ?? '');
    const lines = String(block?.contentMarkdown ?? '').split(/\r?\n/);
    let ordinal = 0;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      if (FENCE_LINE.test(line)) {
        insideFence = !insideFence;
        continue;
      }
      if (insideFence) continue;

      const match = TASK_LINE.exec(line);
      if (!match) continue;
      const [, indent, bullet, , marker, , rest] = match;
      const { text, dueDate } = extractDueDate(rest);
      tasks.push({
        blockId,
        ordinal,
        lineIndex,
        indent,
        bullet,
        text,
        dueDate,
        done: marker.toLowerCase() === 'x',
      });
      ordinal += 1;
    }
  }

  return tasks;
}

/** A task's identity: stable while its block survives and its position in that block holds. */
export function taskId(noteId, blockId, ordinal) {
  return `${noteId}:${blockId}:${ordinal}`;
}

/**
 * Rewrites one task line inside its block, leaving every other line untouched.
 * Returns the new block markdown, or null when the task is no longer there.
 */
export function applyTaskEditToBlock(blockMarkdown, ordinal, patch) {
  const lines = String(blockMarkdown ?? '').split(/\r?\n/);
  let seen = 0;
  let insideFence = false;

  for (let i = 0; i < lines.length; i += 1) {
    if (FENCE_LINE.test(lines[i])) {
      insideFence = !insideFence;
      continue;
    }
    if (insideFence) continue;
    const match = TASK_LINE.exec(lines[i]);
    if (!match) continue;
    if (seen !== ordinal) {
      seen += 1;
      continue;
    }

    const [, indent, bullet, , marker, , rest] = match;
    const current = extractDueDate(rest);
    lines[i] = formatTaskLine({
      indent,
      bullet,
      done: patch.done === undefined ? marker.toLowerCase() === 'x' : Boolean(patch.done),
      text: patch.text === undefined ? current.text : String(patch.text),
      dueDate: patch.dueDate === undefined ? current.dueDate : patch.dueDate,
    });
    return lines.join('\n');
  }

  return null;
}

/**
 * Inbox ordering: what is due soonest first (so overdue rises to the top),
 * then undated work, then whatever was just ticked off.
 */
export function compareTasksForInbox(a, b) {
  const rank = (task) => (task.done ? 2 : (task.dueDate ? 0 : 1));
  const byRank = rank(a) - rank(b);
  if (byRank !== 0) return byRank;

  if (!a.done && a.dueDate && b.dueDate) {
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  }
  if (a.done && b.done) {
    // Most recently completed first, so an accidental tick is easy to find.
    const at = a.completedAt ?? '';
    const bt = b.completedAt ?? '';
    if (at !== bt) return at > bt ? -1 : 1;
  }
  return String(a.text).localeCompare(String(b.text), undefined, { sensitivity: 'base' });
}
