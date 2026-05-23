# PuzzlePKM

<p align="center">
  <img src="./public/icons/icon-128.png" alt="PuzzlePKM icon" width="96" height="96" />
</p>

A local-first knowledge management app with folder-based sync. The core product surface is the CLI in `cli.mjs`, with a desktop wrapper powered by Tauri.

## Features

- **Topic Notes** – Rich-text notes with tags and bi-directional links to other objects; optional date metadata can place them on calendar views (see [`DEC-43`](./IMPLEMENTATION_DECISIONS.md) and [`DEC-44`](./IMPLEMENTATION_DECISIONS.md))
- **Daily Notes** – One note per calendar day with date-link lifecycle guardrails (date-anchored routing, uniqueness enforced; see [`DEC-42`](./IMPLEMENTATION_DECISIONS.md) and [`DEC-46`](./IMPLEMENTATION_DECISIONS.md))
- **Projects & Reference Materials** – Sync-backed directories browsable inside the app. Each directory is named by slug derived from the project/reference material title and contains a `meta.yaml` file with metadata. Directories can contain user files alongside the metadata.
- **Habits** – Lightweight dated entries (≤ 255 chars) with a single identity tag and lifecycle status (`planned`/`accomplished`) (see [`DEC-45`](./IMPLEMENTATION_DECISIONS.md))
- **Scripture** – Save-time scripture reference extraction/normalization for notes, with canonical Bible Gateway links and shared Scripture objects ordered by canonical book sequence (see [`DEC-51`](./IMPLEMENTATION_DECISIONS.md))
- **Tags** – Case-insensitive, aggregate any object type
- **Local-folder sync** – Sync against a configured local root folder
- **Offline-first** – SQLite local store; sync when connected
- **Background sync daemon** – `puzzlepkm sync --watch` for continuous background syncing
- **iOS companion app** – Write-only iPhone app for capturing daily notes and habits on the go; entries are merged on the next desktop sync (see [`DEC-55`](./IMPLEMENTATION_DECISIONS.md) and [`ios/README.md`](./ios/README.md))

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
- **Tabbed object workspace** – Open multiple objects side-by-side in editor tabs, with per-tab unsaved-change indicators and close confirmation (see [`DEC-49`](./IMPLEMENTATION_DECISIONS.md))
- **@ Mentions** – Link to other objects by typing `@` in note content; supports block-level link targets using `syncPath#blockId` format (legacy `dropboxPath` still resolves for compatibility; see [`DEC-36`](./IMPLEMENTATION_DECISIONS.md))
- **Block-backed note content** – Note bodies are authored from ordered `note_blocks`; legacy note-level `content_markdown` is now a compatibility read fallback only (see [`DEC-40`](./IMPLEMENTATION_DECISIONS.md))
- **Tag Management** – Organize content with tags (bottom of editor)
- **Sidebar Navigation** – Quick access to all views with Collections-based layout (see [`DEC-50`](./IMPLEMENTATION_DECISIONS.md))
- **Pinned Sidebar Section** – Tag any object with `Pinned` to surface it under sidebar **Pinned**; order can be manually rearranged and is saved locally (see [`DEC-48`](./IMPLEMENTATION_DECISIONS.md))

See [HEPTABASE_INTERFACE_CHANGE_PLAN.md](./HEPTABASE_INTERFACE_CHANGE_PLAN.md) for the current desktop UI design and implementation roadmap.

## Development Setup

### Prerequisites
- Node.js 22+ (uses built-in `node:sqlite`)
- macOS, Linux, or Windows
- Optional: Dropbox desktop client if you want cloud replication of the sync folder

### 1. Install dependencies

```bash
npm install
```

### 2. Configure sync root folder

Set the folder PuzzlePKM should sync against. You can use a local folder that is also synced by the Dropbox desktop app. The legacy `/Dropith` virtual root remains the compatibility default for existing installs.

```bash
npm run cli -- settings set root-folder "/Dropith"
```

By default, `/Dropith` maps to:
- macOS: `~/Library/CloudStorage/Dropbox/Dropith`
- Linux/Windows fallback: `~/Dropbox/Dropith`

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

# Batch import Markdown notes from a directory
puzzlepkm import daily-note ./daily-notes
puzzlepkm import topic-note ./topic-notes
```

#### Settings

```bash
puzzlepkm settings show
puzzlepkm settings set root-folder /Dropith
```

Default CLI database path follows platform app-data conventions:
- macOS: `~/Library/Application Support/dropith/dropith.sqlite`
- Linux: `~/.config/dropith/dropith.sqlite` (or `$XDG_CONFIG_HOME/dropith/dropith.sqlite`)
- Windows: `%APPDATA%\\dropith\\dropith.sqlite`

Install globally from a checkout (optional) to use the `puzzlepkm` command. The legacy `dropith` alias is still installed for compatibility:

```bash
npm install -g .
puzzlepkm --help
```

Use `PUZZLEPKM_DB_PATH` to point the CLI at a specific PuzzlePKM SQLite file. `DROPITH_DB_PATH` remains supported as a legacy alias:

```bash
PUZZLEPKM_DB_PATH=/absolute/path/to/dropith.sqlite puzzlepkm list
```

#### Compatibility strategy

- `puzzlepkm` is the primary CLI name; `dropith` remains available as a compatibility alias in this release.
- Existing local data/config continue to live in legacy `dropith` app-data folders, and the desktop bundle identifier stays `com.dropith.desktop`, to avoid abrupt migration breakage.
- The legacy `/Dropith` virtual root remains supported and is still the default auto-mapped sync location for current installs.

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

For full details on automated issue sequencing and Copilot PR merging, see [`archive/SEQUENCING_v1.md`](./archive/SEQUENCING_v1.md).

## SQLite scale benchmark

Use the benchmark harness to generate a repeatable synthetic dataset, run key operations, and emit JSON results:

```bash
npm run benchmark:sqlite -- --runs 5 --keep-artifacts
```

The script measures list/get/search/save/sync reconcile/backlink refresh and records query plans in `sqlite-benchmark-results.json`.
The repository includes a captured sample run at [`benchmarks/sqlite-benchmark-sample.json`](./benchmarks/sqlite-benchmark-sample.json).

Latest benchmark evidence (5,760-object dataset: 2,000 topic notes, 1,200 daily notes, 800 habits, 400 projects, 400 ref materials, 900 scriptures, 60 tags):

- `list.topic-notes.legacy-simulation`: **54.35ms avg**
- `list.topic-notes` (batched tags + block reads): **29.10ms avg**
- `search.notes-filter`: **29.61ms avg**
- `save.topic-note`: **10.97ms avg**
- `backlink.refresh.topic-note`: **9.05ms avg**
- `sync.reconcile` (single pass upload of 4,800 local objects): **6435.97ms**

Recommendation: stay on SQLite for the current product scope (thousands of objects) and continue query/index hardening before considering an alternative datastore. Revisit only if routine list/search/save operations trend above ~150ms at this scale or if sync throughput requirements materially exceed current local-folder behavior.

## Project Structure

```
cli.mjs            Standalone CLI (no build step — runs directly with Node.js 22+)
src/               Lightweight companion web shell (React / TypeScript)
src-tauri/         Desktop wrapper host (Tauri config + Rust commands)
public/            Static assets for the web shell
ios/               iOS companion app (Swift / SwiftUI)
```

## iOS Companion App

The `ios/` directory contains a write-only iPhone app for capturing daily notes and habits on the go. Entries are written to a `mobile-inbox/` sub-folder inside your Dropbox sync root and merged into the desktop app on the next `puzzlepkm sync`.

See [`ios/README.md`](./ios/README.md) for Xcode setup instructions and [`DEC-55`](./IMPLEMENTATION_DECISIONS.md) for the design decision record.

```bash
# After writing notes/habits from the iOS app, merge them on the desktop:
puzzlepkm sync
```

## Development Plan

See [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) for the full staged roadmap.
