import { execFileSync } from 'node:child_process';

const repo = 'mjwegenka/dropith';

const labels = [
  { name: 'area:cli', color: '0E8A16', description: 'CLI surface and command behavior' },
  { name: 'area:desktop-ui', color: '1D76DB', description: 'Desktop UI shell and editor behavior' },
  { name: 'area:data-model', color: '5319E7', description: 'Schema, object model, and migrations' },
  { name: 'area:sync', color: '0052CC', description: 'Local folder sync and reconciliation' },
  { name: 'migration', color: 'FBCA04', description: 'Migration or transitional rollout work' },
  { name: 'needs-decision', color: 'D93F0B', description: 'Requires a recorded implementation decision' },
  { name: 'area:navigation', color: 'C5DEF5', description: 'Navigation structure and routing' },
  { name: 'area:performance', color: 'BFDADC', description: 'Performance analysis or optimization' },
  { name: 'area:docs', color: '0075CA', description: 'Documentation and release-readiness content' },
  { name: 'area:branding', color: 'F9D0C4', description: 'Naming, identity, and product branding' },
  { name: 'area:scripture', color: 'B60205', description: 'Scripture parsing/object features' },
];

const milestones = [
  'Block-level linking foundation',
  'Local-first product expansion',
  'PuzzlePKM v1 readiness',
];

const issuePlan = [
  { number: 37, milestone: milestones[0], labels: ['area:data-model', 'migration', 'needs-decision'] },
  { number: 38, milestone: milestones[0], labels: ['area:data-model', 'area:cli', 'migration'] },
  { number: 39, milestone: milestones[0], labels: ['area:cli', 'area:data-model', 'migration'] },
  { number: 40, milestone: milestones[0], labels: ['area:sync', 'area:cli', 'migration'] },
  { number: 41, milestone: milestones[0], labels: ['area:desktop-ui', 'area:cli', 'area:data-model', 'migration'] },
  { number: 42, milestone: milestones[0], labels: ['area:desktop-ui', 'migration'] },
  { number: 43, milestone: milestones[0], labels: ['area:data-model', 'area:cli', 'migration'] },
  { number: 44, milestone: milestones[0], labels: ['area:cli', 'area:docs', 'migration'] },
  { number: 45, milestone: milestones[1], labels: ['area:cli', 'area:docs', 'area:sync'] },
  { number: 46, milestone: milestones[1], labels: ['area:docs', 'area:data-model', 'needs-decision'] },
  { number: 47, milestone: milestones[1], labels: ['area:cli', 'area:data-model'] },
  { number: 48, milestone: milestones[1], labels: ['area:cli', 'area:data-model'] },
  { number: 49, milestone: milestones[1], labels: ['area:cli', 'area:desktop-ui', 'area:data-model'] },
  { number: 50, milestone: milestones[1], labels: ['area:sync', 'area:desktop-ui'] },
  { number: 51, milestone: milestones[1], labels: ['area:navigation', 'area:desktop-ui'] },
  { number: 52, milestone: milestones[1], labels: ['area:desktop-ui', 'area:navigation'] },
  { number: 53, milestone: milestones[1], labels: ['area:desktop-ui'] },
  { number: 54, milestone: milestones[1], labels: ['area:navigation', 'area:desktop-ui'] },
  { number: 55, milestone: milestones[1], labels: ['area:scripture', 'area:cli', 'area:desktop-ui'] },
  { number: 56, milestone: milestones[1], labels: ['area:desktop-ui', 'area:sync'] },
  { number: 57, milestone: milestones[1], labels: ['area:performance', 'area:cli', 'area:data-model'] },
  { number: 58, milestone: milestones[2], labels: ['area:branding', 'area:docs'] },
  { number: 59, milestone: milestones[2], labels: ['area:docs'] },
];

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
}

const existingLabels = new Set(
  JSON.parse(run('gh', ['label', 'list', '-R', repo, '--limit', '300', '--json', 'name'])).map((l) => l.name),
);

for (const label of labels) {
  if (existingLabels.has(label.name)) continue;
  run('gh', ['label', 'create', label.name, '-R', repo, '--color', label.color, '--description', label.description]);
}

const existingMilestones = new Set(
  JSON.parse(run('gh', ['api', `repos/${repo}/milestones`, '--paginate'])).map((m) => m.title),
);

for (const milestone of milestones) {
  if (existingMilestones.has(milestone)) continue;
  run('gh', ['api', `repos/${repo}/milestones`, '--method', 'POST', '-f', `title=${milestone}`]);
}

for (const issue of issuePlan) {
  const labelsForIssue = ['enhancement', ...issue.labels].join(',');
  run('gh', ['issue', 'edit', String(issue.number), '-R', repo, '--add-label', labelsForIssue, '--milestone', issue.milestone]);
}

console.log('Applied labels and milestones to issues 37-59.');

