# PuzzlePKM

<p>
  <img src="./public/icons/icon-128.png" alt="PuzzlePKM icon" width="128" height="128" />
</p>

A local-first knowledge management app with folder-based sync. The core product surface is the CLI (`cli.mjs` entrypoint + `cli/` modules), with a desktop wrapper powered by Tauri.

## Features

- **Topic Notes** – Rich-text notes with tags and bi-directional links to other objects; optional date metadata can place them on calendar views (see [`DEC-40`](./IMPLEMENTATION_DECISIONS.md) and [`DEC-41`](./IMPLEMENTATION_DECISIONS.md))
- **Daily Notes** – One note per calendar day with date-link lifecycle guardrails (date-anchored routing, uniqueness enforced; see [`DEC-39`](./IMPLEMENTATION_DECISIONS.md) and [`DEC-43`](./IMPLEMENTATION_DECISIONS.md))
- **Projects & Reference Materials** – Sync-backed directories browsable inside the app. Each directory is named by slug derived from the project/reference material title and contains a `meta.yaml` file with metadata. Directories can contain user files alongside the metadata.
- **Habits** – Lightweight dated entries (≤ 255 chars) with a single identity tag and lifecycle status (`planned`/`accomplished`) (see [`DEC-42`](./IMPLEMENTATION_DECISIONS.md))
- **Scripture** – Save-time scripture reference extraction/normalization for notes, with canonical Bible Gateway links and shared Scripture objects ordered by canonical book sequence (see [`DEC-48`](./IMPLEMENTATION_DECISIONS.md))
- **Tags** – Case-insensitive, aggregate any object type
- **Local-folder sync** – Sync against a configured local root folder
- **Offline-first** – SQLite local store; sync when connected
- **Background sync daemon** – `puzzlepkm sync --watch` for continuous background syncing
- **iOS companion app** – Write-only iPhone app for capturing daily notes and habits on the go; entries are merged on the next desktop sync (see [`DEC-52`](./IMPLEMENTATION_DECISIONS.md) and [`ios/README.md`](./ios/README.md))

## Tech Stack

| Layer | Choice |
|---|---|
| CLI | Pure Node.js (`cli.mjs`) — no build step required |
| Desktop wrapper | Tauri v2 (Rust host + web UI shell) |
| Companion web shell | React 18 + TypeScript + Vite |
| Desktop UI | Material UI + custom components |
| Local store | node:sqlite (built-in SQLite) |
| Styling | Material UI + TailwindCSS v4 |
| Secure storage | app-managed secrets file (see `DEC-03`) |
| Sync transport | Local folder sync |
| iOS mobile app | SwiftUI (iOS 17+) + SwiftyDropbox SDK |

## Desktop UI Features

The desktop wrapper provides a full-featured interface for knowledge management:

- **Calendar View** – Navigate daily notes by date
- **File Browser** – Browse and manage projects and reference materials
- **Object Editor** – Create and edit notes with rich text support
- **Tabbed object workspace** – Open multiple objects side-by-side in editor tabs, with per-tab unsaved-change indicators and close confirmation (see [`DEC-46`](./IMPLEMENTATION_DECISIONS.md))
- **@ Mentions** – Link to other objects by typing `@` in note content; uses UUID-keyed internal hrefs and supports block-level targets via `objectId#blockId` (see [`DEC-34`](./IMPLEMENTATION_DECISIONS.md) and [`DEC-57`](./IMPLEMENTATION_DECISIONS.md))
- **Block-backed note content** – Note bodies are authored from ordered `note_blocks`, which are the canonical persisted source for note content (see [`DEC-38`](./IMPLEMENTATION_DECISIONS.md))
- **Tag Management** – Organize content with tags (bottom of editor)
- **Sidebar Navigation** – Primary destinations are Library, Calendar, and Graph (plus Settings). Scripture discovery/listing is in existing Library/object-detail surfaces rather than a standalone page (see [`DEC-55`](./IMPLEMENTATION_DECISIONS.md))
- **Pinned Sidebar Section** – Tag any object with `Pinned` to surface it under sidebar **Pinned**; order can be manually rearranged and is saved locally (see [`DEC-45`](./IMPLEMENTATION_DECISIONS.md))

See the `Desktop UI Contract Work (In Progress)` section in this README for the current desktop UI implementation roadmap.

## Development Setup

### Prerequisites
- Node.js 22+ (uses built-in `node:sqlite`)
- macOS, Linux, or Windows
- Optional: any cloud-sync desktop client if you want off-device replication of the sync folder

### 1. Install dependencies

```bash
npm install
```

### 2. Configure sync root folder

Set the folder PuzzlePKM should sync against. You can use any local folder, including one mirrored by your cloud-sync client.

```bash
npm run cli -- settings set root-folder "/PuzzlePKM"
```

By default, `/PuzzlePKM` maps to:
- macOS: `~/Library/CloudStorage/Sync/PuzzlePKM`
- Linux/Windows fallback: `~/Sync/PuzzlePKM`

### 3. Run the companion web shell in development

```bash
npm run dev
```

### 4. Run the desktop wrapper in development

```bash
npm run tauri:dev
```

### CLI usage

Run the CLI directly:

```bash
npm run cli -- --help
```

Run the interactive shell:

```bash
npm run cli
```

The shell exits with `Ctrl+C` or `Ctrl+D`.

#### Sync

```bash
# One-shot sync with local folder
puzzlepkm sync

# Background sync daemon (syncs every 15 minutes by default)
puzzlepkm sync --watch

# Background sync with custom interval
puzzlepkm sync --watch --interval 5
```

`puzzlepkm sync` syncs daily notes, topic notes, habits, projects, and reference materials against the configured local sync root. If sync folders are missing, PuzzlePKM creates them automatically. Projects and reference materials are stored as directories:

- **Daily notes**: `{rootFolder}/daily-notes/{date}.md`
- **Topic notes**: `{rootFolder}/topic-notes/{slug}-{shortId}.md`
- **Habits**: `{rootFolder}/habits/{date}-{firstTag}-{last6CharsOfId}.md`
- **Projects**: `{rootFolder}/projects/{slug}/meta.yaml` (directory can contain user files)
- **Reference Materials**: `{rootFolder}/ref-materials/{slug}/meta.yaml` (directory can contain user files)

Internal links remain canonical UUID hrefs in storage/editor surfaces (`DEC-57`), while sync serialization applies `DEC-56` resolver precedence to produce BibleGateway scripture URLs or safe relative filesystem paths when possible.

When a project or reference material name changes, its directory is renamed to match the new slug. Sync directory names are automatically determined by the project/reference material title.

If a note has previously been synced and then its Markdown file is deleted from an existing sync notes folder, the next sync deletes the local copy instead of recreating it. If an entire sync notes folder is missing, PuzzlePKM recreates that folder, leaves local data unchanged for that run, and reports a warning to avoid accidental mass deletion.

Deleting sync-tracked objects from PuzzlePKM (`puzzlepkm delete ...` or desktop UI delete flows) performs a hard delete: PuzzlePKM deletes the corresponding file/folder path in the configured sync root first, then removes the local database record.

Daily Note creation is non-overwriting: if a note already exists for a date, PuzzlePKM opens/edits the existing note instead of creating a second note or overwriting via “new note” flow.

#### Notes and objects

```bash
puzzlepkm add "Quick note text"
puzzlepkm list daily-note
puzzlepkm get topic-note <id>
puzzlepkm create project
puzzlepkm update habit <id>
puzzlepkm delete tag <id>
puzzlepkm browse all
puzzlepkm migrate-links --dry-run
puzzlepkm migrate-links --apply

# Batch import Markdown notes from a directory
puzzlepkm import daily-note ./daily-notes
puzzlepkm import topic-note ./topic-notes
```

#### Settings

```bash
puzzlepkm settings show
puzzlepkm settings set root-folder /PuzzlePKM
```

Default CLI database path follows platform app-data conventions:
- macOS: `~/Library/Application Support/puzzlepkm/puzzlepkm.sqlite`
- Linux: `~/.config/puzzlepkm/puzzlepkm.sqlite` (or `$XDG_CONFIG_HOME/puzzlepkm/puzzlepkm.sqlite`)
- Windows: `%APPDATA%\\puzzlepkm\\puzzlepkm.sqlite`

Install globally from a checkout (optional) to use the `puzzlepkm` command:

```bash
npm install -g .
puzzlepkm --help
```

Use `PUZZLEPKM_DB_PATH` to point the CLI at a specific PuzzlePKM SQLite file:

```bash
PUZZLEPKM_DB_PATH=/absolute/path/to/puzzlepkm.sqlite puzzlepkm list
```

#### Runtime naming

- CLI command: `puzzlepkm`
- Database env var: `PUZZLEPKM_DB_PATH`
- App-data folder names: `puzzlepkm`
- Desktop bundle identifier: `com.puzzlepkm.desktop`

### 5. Build for production

```bash
npm run build
```

Build desktop packages:

```bash
npm run tauri:build
```

To run the full build alias used by repo automation:

```bash
npm run build:all
```

Lint the codebase:

```bash
npm run lint
```

Run CLI smoke coverage (create/get/list/update/delete/sync paths):

```bash
npm run test:smoke
```

Run the SQLite scale benchmark harness:

```bash
npm run benchmark:sqlite
```

Issue queue automation helpers:

```bash
# Dry run queue sequencing labels
npm run issues:queue

# Apply queue sequencing labels from local CLI
npm run issues:queue:apply
```

For issue sequencing details, use the automation scripts in `scripts/` (`issue_sequence_runner.mjs` and `apply_issue_labels_and_milestones.mjs`).

## SQLite scale benchmark

Use the benchmark harness to generate a repeatable synthetic dataset, run key operations, and emit JSON results:

```bash
npm run benchmark:sqlite -- --runs 5 --keep-artifacts
```

The script measures list/get/search/save/sync reconcile/backlink refresh and records query plans in `sqlite-benchmark-results.json`.
The repository includes a captured sample run at [`benchmarks/sqlite-benchmark-sample.json`](./benchmarks/sqlite-benchmark-sample.json).

Latest benchmark evidence (5,760-object dataset: 2,000 topic notes, 1,200 daily notes, 800 habits, 400 projects, 400 ref materials, 900 scriptures, 60 tags):

- `list.topic-notes.baseline-simulation`: **54.35ms avg**
- `list.topic-notes` (batched tags + block reads): **29.10ms avg**
- `search.notes-filter`: **29.61ms avg**
- `save.topic-note`: **10.97ms avg**
- `backlink.refresh.topic-note`: **9.05ms avg**
- `sync.reconcile` (single pass upload of 4,800 local objects): **6435.97ms**

Recommendation: stay on SQLite for the current product scope (thousands of objects) and continue query/index hardening before considering an alternative datastore. Revisit only if routine list/search/save operations trend above ~150ms at this scale or if sync throughput requirements materially exceed current local-folder behavior.

## Project Structure

```
cli.mjs            Standalone CLI entrypoint (no build step — runs directly with Node.js 22+)
cli/               Modular CLI command/domain implementation
src/               Lightweight companion web shell (React / TypeScript)
src-tauri/         Desktop wrapper host (Tauri config + Rust commands)
public/            Static assets for the web shell
ios/               iOS companion app (Swift / SwiftUI)
```

CLI modular ownership follows `DEC-53`/`DEC-54`: command routing lives under `cli/commands/`, while per-object boundaries live under `cli/objects/<object-type>/` with `definition.mjs`, `repository.mjs`, and `service.mjs`.

## iOS Companion App

The `ios/` directory contains a write-only iPhone app for capturing daily notes and habits on the go. Entries are written to a `mobile-inbox/` sub-folder inside your Dropbox sync root and merged into the desktop app on the next `puzzlepkm sync`.

See [`ios/README.md`](./ios/README.md) for Xcode setup instructions and [`DEC-52`](./IMPLEMENTATION_DECISIONS.md) for the design decision record.

```bash
# After writing notes/habits from the iOS app, merge them on the desktop:
puzzlepkm sync
```

## Project Status

- Core product scope is implemented and stable for local-first use.
- v1 release-readiness verification is the active delivery gate.
- iOS companion app is implemented and integrated with desktop sync.

## Implementation Notes (CLI modularization + link model docs slice)

- Roadmap wiring for this docs-alignment slice is tracked in `DEC-59` (depends on #195, #198, #199, #200, #201; unblocks none).
- Relevant behavior decisions for this slice: `DEC-53`, `DEC-54`, `DEC-55`, `DEC-56`, `DEC-57`, `DEC-58`, `DEC-59`.

## v1 Release Readiness Checklist

Use this checklist to determine release readiness (`DEC-51`).

**Regression**
- [ ] All object types (daily-note, topic-note, habit, project, ref-material, scripture) can be created, read, updated, and deleted via CLI without data loss.
- [ ] `note_blocks` backfill runs idempotently on `openDb()` for all notes; malformed rows emit warnings and do not abort startup.
- [ ] Block IDs match `blk-<12 hex chars>` format; positions are contiguous and unique per note.
- [ ] Daily Note date identity is immutable: update flows reject date-field mutations.
- [ ] Habit writes enforce one-tag rule and persist a valid `status` value.
- [ ] Backlink sets remain reciprocal after add/remove/edit of a source link.

**Sync safety**
- [ ] One-shot `puzzlepkm sync` completes without data loss across all object types.
- [ ] Background `puzzlepkm sync --watch` operates correctly with the default 15-minute interval and a custom `--interval`.
- [ ] Missing sync folder triggers folder creation and skips deletion reconciliation for that type on the same run (safe fallback).
- [ ] Deleting a locally-tracked object removes its sync file before the DB record is dropped.
- [ ] Inbox tag is added exactly once to newly imported objects; existing objects are never re-tagged on subsequent syncs.
- [ ] `syncPath` metadata is present and correct in serialized front matter.

**Migration flows**
- [ ] Opening existing databases auto-backfills `note_blocks` from `content_markdown` without data loss.
- [ ] Markdown without embedded block IDs receives fresh block IDs on import; no content is dropped.
- [ ] Links resolve correctly with local-sync transport metadata (`DEC-08`).
- [ ] `PUZZLEPKM_DB_PATH` resolves to the correct database.
- [ ] `puzzlepkm` CLI command resolves to the expected binary.

**Documentation**
- [ ] Command lists in `README.md` and `AGENTS.md` are identical and cover all runnable commands.
- [ ] All `DEC-*` references in `README.md` resolve to entries in `IMPLEMENTATION_DECISIONS.md`.
- [ ] No behavioral rule appears in more than one canonical file.