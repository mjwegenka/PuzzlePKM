#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';

const repo = process.env.ISSUE_REPO || 'mjwegenka/puzzlepkm';
const sequencePath = new URL('../.github/issue-sequence.json', import.meta.url);
const sequence = JSON.parse(readFileSync(sequencePath, 'utf8'));

const READY = 'status:ready';
const BLOCKED = 'status:blocked';
const apply = process.argv.includes('--apply');

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' }).trim();
}

function ensureLabels() {
  const existing = new Set(
    JSON.parse(gh(['label', 'list', '-R', repo, '--limit', '300', '--json', 'name'])).map((label) => label.name),
  );
  if (!existing.has(READY)) {
    gh(['label', 'create', READY, '-R', repo, '--color', '0E8A16', '--description', 'Next issue ready to execute in sequence']);
  }
  if (!existing.has(BLOCKED)) {
    gh(['label', 'create', BLOCKED, '-R', repo, '--color', 'B60205', '--description', 'Blocked by dependencies in the roadmap queue']);
  }
}

function setIssueLabels(issueNumber, labels) {
  const args = ['api', `repos/${repo}/issues/${issueNumber}`, '--method', 'PATCH'];
  for (const label of labels) {
    args.push('-f', `labels[]=${label}`);
  }
  if (labels.length === 0) {
    args.push('-f', 'labels[]');
  }
  gh(args);
}

const issueNumbers = sequence.issues.map((i) => i.number);
const stateByNumber = new Map();
const labelsByNumber = new Map();

for (const number of issueNumbers) {
  const issue = JSON.parse(gh(['issue', 'view', String(number), '-R', repo, '--json', 'state,title,labels,url']));
  stateByNumber.set(number, issue.state.toLowerCase());
  labelsByNumber.set(number, issue.labels.map((l) => l.name));
}

let readyHead = null;
for (const item of sequence.issues) {
  if (stateByNumber.get(item.number) !== 'open') continue;
  const depsMet = item.dependsOn.every((dep) => stateByNumber.get(dep) === 'closed');
  if (depsMet) {
    readyHead = item.number;
    break;
  }
}

const updates = [];
for (const item of sequence.issues) {
  if (stateByNumber.get(item.number) !== 'open') continue;
  const current = labelsByNumber.get(item.number) ?? [];
  const base = current.filter((l) => l !== READY && l !== BLOCKED);
  const depsMet = item.dependsOn.every((dep) => stateByNumber.get(dep) === 'closed');

  if (!depsMet) {
    updates.push({ number: item.number, labels: [...base, BLOCKED] });
    continue;
  }

  if (item.number === readyHead) {
    updates.push({ number: item.number, labels: [...base, READY] });
  } else {
    updates.push({ number: item.number, labels: base });
  }
}

console.log(`Repository: ${repo}`);
console.log(`Queue head: ${readyHead ? `#${readyHead}` : '(none)'}`);
if (apply) {
  ensureLabels();
}
for (const update of updates) {
  const current = labelsByNumber.get(update.number) ?? [];
  const normalizedCurrent = [...current].sort().join(',');
  const normalizedNext = [...update.labels].sort().join(',');
  if (normalizedCurrent === normalizedNext) continue;
  console.log(`- #${update.number}: [${current.join(', ')}] -> [${update.labels.join(', ')}]`);

  if (apply) {
    setIssueLabels(update.number, update.labels);
  }
}

if (!apply) {
  console.log('\nDry run only. Re-run with --apply to update GitHub labels.');
}

