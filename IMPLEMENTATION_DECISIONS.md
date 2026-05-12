# Implementation Decisions

This file documents all implementation decisions for Dropith. Use decision IDs (e.g., `DEC-01`) in code comments and PRs to maintain traceability.

## Architecture & Delivery

- `DEC-01` Primary interface is the CLI (`cli.mjs`), which runs standalone with Node.js 22+ (no build step). All features are available in the CLI. A Tauri desktop wrapper provides a secondary UI that delegates all operations back to the CLI via subprocess execution, ensuring feature parity.
- `DEC-02` Companion web shell (React + TypeScript + Vite) conforms to `UI_Design_Contract.json` for tokens, responsive behavior, and component states. Desktop packaging uses Tauri v2 (Rust host + web UI).
- `DEC-03` Local persistence uses built-in `node:sqlite`; no native database addons. Secrets are stored in an app-managed `secrets.json` file shared by CLI and desktop wrapper.
- `DEC-04` Platform target is macOS-first; application data stored per platform conventions: macOS `~/Library/Application Support/dropith/`, Linux `~/.config/dropith/`, Windows `%APPDATA%\dropith\`.

## Data Model

- `DEC-05` Object types: **Daily Notes** (one per calendar date, uniqueness by local timezone), **Topic Notes** (free-form with titles, searchable), **Habits** (≤255 chars per entry, dated), **Projects** (Dropbox-backed directories), **Reference Materials** (Dropbox-backed directories), **Tags** (case-insensitive, aggregable across object types), **Links** (ID-based bidirectional associations).
- `DEC-06` All objects store `id`, `createdAt`, `updatedAt` timestamps (ISO 8601). Tags are display names (human-readable). Links store source/target IDs with types; no path metadata required.
- `DEC-07` All note objects (Daily, Topic) support: rich-text Markdown content, tags, bidirectional links to any object type, and YAML front matter with metadata.

## Dropbox Sync

- `DEC-08` Daily notes stored at `{rootFolder}/daily-notes/YYYY-MM-DD.md`; Topic notes at `{rootFolder}/topic-notes/{slug}-{shortId}.md`. YAML front matter contains all metadata; Markdown body follows. User can configure any Dropbox root folder; default is `/Dropith`.
- `DEC-09` Dropbox is source of truth for remote state: bidirectional last-write-wins conflict resolution. Remote updates apply if remote `updatedAt > local updatedAt`. Local updates upload if local `updatedAt > remote updatedAt`. When timestamps are equal, content differences (body, title, tags, links) trigger updates to catch manual Dropbox edits. Sync state tracks whether each note has previously had a Dropbox copy.
- `DEC-10` Sync reconciliation (import Dropbox notes, upload unsynced notes, delete locally-synced notes missing from Dropbox) runs on manual `sync` command or background `sync --watch` daemon. If a Dropbox notes folder is missing, local notes are left unchanged (safe fallback); if folder exists but note is gone, deletion behavior depends on sync state. One-shot and daemon modes available; background sync supports custom interval (default 15 minutes).
- `DEC-11` Dropbox OAuth uses browser-based flow via `http://localhost:42813/callback`. Tokens stored in `secrets.json`. No encryption-at-rest requirement for local cache or metadata in v1.
- `DEC-17` Dropbox sync includes habits, projects, and reference materials in addition to notes. Sync ensures required Dropbox folders exist (`daily-notes`, `topic-notes`, `habits`, `projects`, `ref-materials`) and creates missing folders. If a folder was missing at sync start, Dropith recreates it and skips remote-deletion reconciliation for that object type during that run. Projects and reference materials are stored as directories (with name slug derived from title); each directory contains a `meta.yaml` file with metadata (id, name, tags, dates, etc.). When a project/reference material name changes, the directory is renamed to match the new slug. Habits are stored as individual `{id}.md` files. Directories can contain user files alongside the metadata file.

## CRUD & Interop

- `DEC-12` All objects support: create (with defaults/guided), read (single/batch), update (full overwrite), delete (with cascade for links/tags). Batch import: Markdown files from a directory are parsed and imported as a set (daily-notes or topic-notes).
- `DEC-13` All CRUD operations are available in the CLI (`dropith create`, `dropith get`, `dropith list`, `dropith update`, `dropith delete`, `dropith add`). The desktop wrapper invokes these CLI commands and formats output for UI display.
- `DEC-14` Markdown import/export is core: notes are round-tripped through YAML front matter + Markdown body. Habits and other object types output as JSON where Markdown is not applicable. Tag aliases/synonyms not required for v1.

## Authentication

- `DEC-15` Dropbox authentication flow: user runs `dropith auth connect`, which opens a browser for OAuth and stores the returned token locally. Token status available via `dropith auth status`; disconnect via `dropith auth disconnect`. Credentials (App Key / App Secret) can be set via `dropith settings set dropbox <key> <secret>` or environment variables `DROPBOX_APP_KEY` and `DROPBOX_APP_SECRET`.

## Testing & Future

- `DEC-16` No automated test suite required for v1. No telemetry or user tracking. Offline-first; all operations work without Dropbox connection; sync is best-effort and non-blocking.

## Desktop UI

- `DEC-18` The desktop UI requires non-interactive create/update operations that the interactive `create`/`update` CLI commands cannot satisfy. A `write <type> <json>` command is added to the CLI (DEC-01 CLI-first principle preserved): it creates a new object if no matching id/date exists, otherwise updates the existing one. The desktop UI uses `writeObject()` in `cliService.ts` to delegate all saves through this command. Title and date are always rendered first in the editor; tags are always rendered last.

- `DEC-19` The desktop app automatically triggers a one-shot `dropith sync` every 30 seconds via a `SyncContext` (`src/lib/syncContext.tsx`) that wraps the entire app. A manual sync button in the `NavigationSidebar` shows live sync status (syncing spinner, last-synced timestamp, error label). `ObjectEditor` also calls `triggerSync()` after every successful save so changes are pushed to Dropbox immediately. Concurrent syncs are guarded by a ref flag.

- `DEC-20` Habit filenames are now `{date}-{firstTag}-{last6CharsOfId}.md` in Dropbox sync. If a habit has no tags, the filename is `{date}--{last6CharsOfId}.md`. This improves human readability and discovery in Dropbox. The CLI sync logic generates filenames based on the current state of tags and ID. When syncing from Dropbox, filenames are parsed to extract the date; mismatches with stored dates are resolved by backup-file logic.

- `DEC-21` All objects (topic-notes, daily-notes, projects, ref-materials, habits) store a `dropboxPath` field in their metadata, indicating their canonical Dropbox location. Links throughout the app are now path-based (e.g., `[@title](dropbox-path)`) instead of ID-based. This allows links to remain stable even if object IDs are reassigned or migrated.

- `DEC-22` When a user Shift+clicks a link in note content, the application resolves the dropbox path to the target object and opens its editor (either inline or as a modal, depending on context). Regular clicks do not navigate; they are used for display only.

- `DEC-23` Project and Reference Material directory listings exclude `meta.yaml` files from display, showing only user-created files. The `meta.yaml` file is still synced and managed by the app but is not presented to the user as a browsable file.

- `DEC-24` Tags page aggregates and displays all tagged objects including habits.

- `DEC-25` The object viewer/editor in the desktop UI is now a modal dialog instead of a side panel. This gives the calendar view more horizontal space to display object names on calendar chips and improves mobile/tablet responsiveness. Modal sizes follow Material-UI conventions (e.g., `md`, `lg`).

- `DEC-26` Calendar days are rendered with fixed widths (all seven columns equal width) using CSS `gridTemplateColumns: repeat(7, 1fr)`, regardless of content size or number of chips per day. This ensures a consistent, predictable calendar layout.

- `DEC-27` `@`-inserted Markdown links are rendered relative to the current object's Dropbox file location rather than as absolute Dropbox-root paths. For example, a Daily Note linking to `/Dropith/habits/foo.md` stores `../habits/foo.md`, while a Habit linking to another Habit in the same folder stores `foo.md`. If the target object's `dropboxPath` metadata is missing, the app auto-backfills metadata on DB open and only falls back to ID-based links if no canonical path can be resolved.

