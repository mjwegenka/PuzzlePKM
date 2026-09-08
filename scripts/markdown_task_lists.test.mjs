/* eslint-env node */

// Markdown task lists have to survive the editor in both directions. Marked and
// TipTap disagree about how a task list is represented in HTML, and before the
// shared configuration under test here that disagreement was silent data loss:
// `- [x] …` loaded as a plain bullet with the checkbox dropped, and saving wrote
// it back as a bullet, so opening a note with tasks and saving it destroyed them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Marked } from 'marked';
import TurndownService from 'turndown';

import { taskListMarkedExtension, taskListTurndownRule } from '../src/lib/markdownTaskLists.ts';

/** The same configuration RichMarkdownEditor applies, over the same objects. */
function createConverters() {
  const marked = new Marked();
  marked.setOptions({ gfm: true, breaks: true });
  marked.use(taskListMarkedExtension);

  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    strongDelimiter: '**',
  });
  turndown.addRule('taskListItem', taskListTurndownRule);

  return {
    toHtml: (markdown) => marked.parse(markdown),
    toMarkdown: (html) => turndown.turndown(html).trim(),
  };
}

test('a task list renders as the HTML TipTap actually parses', () => {
  const { toHtml } = createConverters();
  const html = toHtml('- [x] Done\n- [ ] Not done');

  // TipTap's TaskList/TaskItem parse `[data-type="…"]` and read `data-checked`;
  // they have no rule at all for marked's default bare checkbox input.
  assert.match(html, /<ul data-type="taskList">/);
  assert.match(html, /<li data-type="taskItem" data-checked="true">/);
  assert.match(html, /<li data-type="taskItem" data-checked="false">/);
  // TaskItem's content is `paragraph+`, so the text must be wrapped.
  assert.match(html, /<div><p>Done<\/p><\/div>/);
});

test('a task survives markdown → editor → markdown unchanged', () => {
  const { toHtml, toMarkdown } = createConverters();
  const cases = [
    '- [x] Athanasius, *Letter to Marcellinus and Vita Antonii* (Mahwah, NJ: Paulist Press, 1980).',
    '- [ ] Email the provincial due:2026-09-15',
    '- [x] Done\n- [ ] Not done\n- [ ] Also not',
    '- [ ] Task with **bold**, *emphasis*, and a [link](https://example.com)',
  ];

  for (const original of cases) {
    assert.equal(toMarkdown(toHtml(original)), original, `round trip changed: ${original}`);
  }
});

test('the checked state itself round-trips, not just the text', () => {
  const { toHtml, toMarkdown } = createConverters();
  assert.equal(toMarkdown(toHtml('- [x] Ticked')), '- [x] Ticked');
  assert.equal(toMarkdown(toHtml('- [ ] Unticked')), '- [ ] Unticked');
});

test('ordinary lists are left to the default rendering', () => {
  const { toHtml } = createConverters();

  const bullets = toHtml('- Plain bullet\n- Another');
  assert.doesNotMatch(bullets, /data-type="taskList"/);
  assert.match(bullets, /<ul>/);

  const ordered = toHtml('1. First\n2. Second');
  assert.doesNotMatch(ordered, /data-type="taskList"/);
  assert.match(ordered, /<ol>/);
});

test('a mixed list falls back rather than inventing checkboxes', () => {
  // TipTap cannot hold a list that is part taskItem and part listItem, so a
  // mixed list renders as an ordinary bullet list instead of being coerced.
  const { toHtml } = createConverters();
  const html = toHtml('- [ ] A task\n- A plain bullet');
  assert.doesNotMatch(html, /data-type="taskList"/);
  assert.doesNotMatch(html, /data-type="taskItem"/);
});

test('the tasks the CLI indexer looks for are the ones the editor writes', async () => {
  // The Inbox reads raw note Markdown, so the editor's output has to match what
  // `cli/tasks/index.mjs` recognises — otherwise a task edited in the editor
  // would quietly drop out of the Inbox.
  const { parseTasksFromBlocks } = await import('../cli/tasks/index.mjs');
  const { toHtml, toMarkdown } = createConverters();

  const written = toMarkdown(toHtml('- [x] Ticked one\n- [ ] Open one due:2026-09-15'));
  const parsed = parseTasksFromBlocks([{ blockId: 'blk-000000000000', contentMarkdown: written }]);

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].done, true);
  assert.equal(parsed[1].text, 'Open one');
  assert.equal(parsed[1].dueDate, '2026-09-15');
});
