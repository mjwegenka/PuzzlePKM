# Automated Issue & PR Sequencing

This repository uses GitHub Actions to automatically sequence issues and merge Copilot-generated PRs.

## How It Works

### 1. Issue Sequencer Workflow (`.github/workflows/issue-sequencer.yml`)

**Trigger:** On issue close/reopen, or manual `workflow_dispatch`

**Behavior:**
- Reads the dependency graph from `.github/issue-sequence.json`
- Determines which issues have all dependencies closed
- Marks the **next ready issue** with `status:ready` label
- Marks blocked issues with `status:blocked` label
- Posts an auto-comment on the ready issue with:
  - Dependency context
  - `@copilot` kickoff line for immediate start
  - Standardized implementation prompt template

**Result:** When an issue becomes `status:ready`, Copilot is automatically notified and can begin work.

### 2. Auto-Merge Copilot PRs Workflow (`.github/workflows/auto-merge-copilot-prs.yml`)

**Trigger:** On PR open/sync/ready_for_review

**Behavior:**
- Detects PRs authored by Copilot
- Waits for all CI checks to pass
- Auto-approves the PR with a summary comment
- Merges using squash strategy
- Extracts the issue number from the PR body (format: `Closes #123`)
- Auto-closes the related issue

**Result:** Once Copilot opens a PR and it passes CI, it is automatically merged and the issue is closed, which triggers the sequencer to advance to the next ready issue.

## Full Unattended Flow

```
Issue ready
    ↓
[Issue Sequencer] marks as status:ready, posts @copilot comment
    ↓
Copilot starts work (responds to @copilot mention)
    ↓
Copilot opens PR with "Closes #N" reference
    ↓
[Auto-Merge Workflow] checks if CI passes
    ↓
If CI passes: approve + merge + close issue
    ↓
Issue closed → triggers [Issue Sequencer] again
    ↓
Next issue marked as status:ready, posts new @copilot comment
    ↓
... repeats until all issues are complete
```

## Local Queue Management

Two npm commands help manage the issue queue locally (e.g., for debugging or re-sequencing):

```bash
# Dry run: show what changes would be applied
npm run issues:queue

# Apply: actually set labels/blocked states on GitHub
npm run issues:queue:apply
```

## Configuration

### Dependency Graph: `.github/issue-sequence.json`

Edit this file to:
- Add new issues
- Define dependencies between issues
- Control sequencing order

Example:
```json
{
  "issues": [
    { "number": 37, "dependsOn": [] },
    { "number": 38, "dependsOn": [37] },
    { "number": 39, "dependsOn": [38] }
  ]
}
```

### Workflow Triggers

Both workflows can be manually triggered via:
```bash
# Sequencer
gh workflow run "Issue Sequencer" -R mjwegenka/puzzlepkm

# Auto-merge
gh workflow run "Auto-Approve and Merge Copilot PRs" -R mjwegenka/puzzlepkm
```

## Safety & Guardrails

- **Auto-merge only runs if all CI checks pass.** If your repo lacks CI, no PRs will merge automatically.
- **Copilot PRs must reference an issue** for auto-close to work (format: PR body must contain `#123` or `Closes #123`).
- **Manual review recommended** on the first run to catch any issues.
- If a Copilot PR fails CI, it remains open for manual intervention.

## Troubleshooting

### Issue not progressing to the next one
1. Check if the current issue is closed (`gh issue view <number> --state`)
2. If closed, run `gh workflow run "Issue Sequencer" ...` to manually trigger sequencer
3. Verify the next issue has `status:ready` label

### PR not auto-merging
1. Check CI status: `gh run list -R mjwegenka/puzzlepkm --workflow="..."`
2. If CI is broken, the PR will not merge (by design)
3. Fix the issue or manually close the PR and allow the issue to be closed

### Copilot not starting work
1. Ensure the ready-issue auto-comment includes the `@copilot` line
2. Check Copilot's subscription/permissions on the repo
3. Manually trigger with: `gh issue comment <number> -R mjwegenka/puzzlepkm --body "@copilot please implement this issue"`

