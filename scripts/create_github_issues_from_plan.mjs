import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const repo = 'mjwegenka/puzzlepkm';
const planPath = '/Users/michael/WebProjects/puzzlepkm/plan-blockLevelNoteLinking.issues.prompt.md';
const text = readFileSync(planPath, 'utf8');

const issueRegex = /^### Issue\s+(\d+)\s+-\s+(.+?)\n([\s\S]*?)(?=^### Issue\s+\d+\s+-|^## Suggested Labels|$)/gm;

const issues = [];
let match;
while ((match = issueRegex.exec(text)) !== null) {
  issues.push({
    number: Number(match[1]),
    title: match[2].trim(),
    bodySection: match[3].trim(),
  });
}

if (!issues.length) {
  throw new Error('No issues parsed from plan file');
}

const existing = JSON.parse(
  execFileSync(
    'gh',
    ['issue', 'list', '-R', repo, '--state', 'all', '--limit', '200', '--json', 'number,title'],
    { encoding: 'utf8' },
  ),
);
const existingByTitle = new Map(existing.map((entry) => [entry.title, entry.number]));

const created = [];
const skipped = [];
for (const issue of issues.sort((a, b) => a.number - b.number)) {
  if (existingByTitle.has(issue.title)) {
    skipped.push({ title: issue.title, number: existingByTitle.get(issue.title) });
    continue;
  }

  const body = `Imported from \`${planPath.split('/').pop()}\` (Issue ${issue.number}).\n\n${issue.bodySection}`;
  const url = execFileSync(
    'gh',
    ['issue', 'create', '-R', repo, '--title', issue.title, '--body', body],
    { encoding: 'utf8' },
  ).trim();

  created.push({ title: issue.title, url });
}

console.log(`Created: ${created.length}`);
for (const issue of created) {
  console.log(`+ ${issue.title} -> ${issue.url}`);
}
console.log(`Skipped existing: ${skipped.length}`);
for (const issue of skipped) {
  console.log(`= #${issue.number} ${issue.title}`);
}

