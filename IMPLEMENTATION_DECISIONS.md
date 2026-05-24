# Implementation Decisions

This file documents all implementation decisions for PuzzlePKM, organized by domain. Use decision IDs (e.g., `DEC-01`) in code comments and PRs to maintain traceability.

---

## Architecture & Delivery

- `DEC-01` Primary interface is the CLI (`cli.mjs`), which runs standalone with Node.js 22+ (no build step). All features are available in the CLI. A Tauri desktop wrapper provides a secondary UI that delegates all operations back to the CLI via subprocess execution, ensuring feature parity.
- `DEC-02` Companion web shell (React + TypeScript + Vite) conforms to `HEPTABASE_INTERFACE_CHANGE_PLAN.md` for responsive behavior and component styling. Desktop packaging uses Tauri v2 (Rust host + web UI).
- `DEC-03` Local persistence uses built-in `node:sqlite`; no native database addons. Secrets are stored in an app-managed `secrets.json` file shared by CLI and desktop wrapper.
- `DEC-04` Platform target is macOS-first; application data stored per platform conventions: macOS `~/Library/Application Support/puzzlepkm/`, Linux `~/.config/puzzlepkm/`, Windows `%APPDATA%\puzzlepkm\`.

---

## Data Model

- `DEC-05` Object types: **Daily Notes** (one per calendar date, uniqueness by local timezone), **Topic Notes** (free-form with titles, searchable), **Habits** (≤255 chars per entry, dated), **Projects** (local-folder-backed directories), **Reference Materials** (local-folder-backed directories), **Tags** (case-insensitive, aggregable across object types), **Links** (ID-based bidirectional associations).
- `DEC-06` All objects store `id`, `createdAt`, `updatedAt` timestamps (ISO 8601). Tags are display names (human-readable). Links store source/target IDs with types; no path metadata required.
- `DEC-07` All note objects (Daily, Topic) support: rich-text Markdown content, tags, bidirectional links to any object type, and YAML front matter with metadata.

---

## Sync Transport (Local-Folder Based)

- `DEC-08` **Active sync transport is local-folder based**: `puzzlepkm sync` reads/writes the configured sync root on the local filesystem. The default virtual root `/PuzzlePKM` maps to a local sync folder path (`~/Library/CloudStorage/Sync/PuzzlePKM` on macOS; `~/Sync/PuzzlePKM` fallback).
- `DEC-09` **Local-sync naming**: User-facing sync terminology uses `syncPath` for canonical object paths.
- `DEC-10` Sync includes habits, projects, and reference materials in addition to notes. Sync ensures required local sync folders exist (`daily-notes`, `topic-notes`, `habits`, `projects`, `ref-materials`) and creates missing folders. If a folder was missing at sync start, PuzzlePKM recreates it and skips remote-deletion reconciliation for that object type during that run. Projects and reference materials are stored as directories (with slug-derived names); each directory contains a `meta.yaml` file with metadata. When a project/reference material name changes, the directory is renamed to match the new slug. Habits are stored as individual `{id}.md` files. Directories can contain user files alongside the metadata file.
- `DEC-11` **Conflict resolution**: Bidirectional last-write-wins semantics. Remote updates apply if remote `updatedAt > local updatedAt`. Local updates upload if local `updatedAt > remote updatedAt`. When timestamps are equal, content differences (body, title, tags, links) trigger updates to catch manual sync folder edits. Sync state tracks whether each note has previously had a local sync copy.
- `DEC-12` **Sync operations**: Reconciliation (import sync notes, upload unsynced notes, delete locally-synced notes missing from sync folder) runs on manual `sync` command or background `sync --watch` daemon. If a sync notes folder is missing, local notes are left unchanged (safe fallback); if folder exists but note is gone, deletion behavior depends on sync state. One-shot and daemon modes available; background sync supports custom interval (default 15 minutes).

---

## CRUD & Interop

- `DEC-13` All objects support: create (with defaults/guided), read (single/batch), update (full overwrite), delete (with cascade for links/tags). Batch import: Markdown files from a directory are parsed and imported as a set (daily-notes or topic-notes).
- `DEC-14` All CRUD operations are available in the CLI (`puzzlepkm create`, `puzzlepkm get`, `puzzlepkm list`, `puzzlepkm update`, `puzzlepkm delete`, `puzzlepkm add`). The desktop wrapper invokes these CLI commands and formats output for UI display.
- `DEC-15` Markdown import/export is core: notes are round-tripped through YAML front matter + Markdown body. Habits and other object types output as JSON where Markdown is not applicable. Tag aliases/synonyms not required for v1.

---

## Testing & Quality

- `DEC-16` No automated test suite required for v1. No telemetry or user tracking. Offline-first; all operations work without sync connection; sync is best-effort and non-blocking.

---

## Desktop UI Core

- `DEC-17` Non-interactive create/update: A `write <type> <json>` CLI command creates a new object if no matching id/date exists, otherwise updates the existing one. The desktop UI uses `writeObject()` in `cliService.ts` to delegate all saves through this command. Title and date are always rendered first in the editor; tags are always rendered last.
- `DEC-18` **Automatic sync**: The desktop app automatically triggers a one-shot `puzzlepkm sync` every 30 seconds via a `SyncContext` (`src/lib/syncContext.tsx`) that wraps the entire app. A manual sync button in the `NavigationSidebar` shows live sync status (syncing spinner, last-synced timestamp, error label). `ObjectEditor` also calls `triggerSync()` after every successful save so changes are pushed immediately. Concurrent syncs are guarded by a ref flag.
- `DEC-19` **Habit filenames**: Now `{date}-{firstTag}-{last6CharsOfId}.md` in sync. If a habit has no tags, the filename is `{date}--{last6CharsOfId}.md`. This improves human readability and discovery. The CLI sync logic generates filenames based on current tag state and ID. When syncing from sync folder, filenames are parsed to extract the date; mismatches with stored dates are resolved by backup-file logic.

---

## Linking & Paths

- `DEC-20` All objects (topic-notes, daily-notes, projects, ref-materials, habits) store a `syncPath` field in their metadata, indicating their canonical sync location. Links throughout the app are path-based (e.g., `[@title](syncPath)`) instead of ID-based. This allows links to remain stable even if object IDs are reassigned or migrated.
- `DEC-21` **Link navigation**: When a user Shift+clicks a link in note content, the application resolves the sync path to the target object and opens its editor (either inline or as a modal). Regular clicks do not navigate; they are used for display only.
- `DEC-22` **Relative path linking**: `@`-inserted Markdown links are rendered relative to the current object's sync file location rather than as absolute sync-root paths. For example, a Daily Note linking to `/PuzzlePKM/habits/foo.md` stores `../habits/foo.md`, while a Habit linking to another Habit in the same folder stores `foo.md`. If the target object's `syncPath` metadata is missing, the app auto-backfills metadata on DB open and only falls back to ID-based links if no canonical path can be resolved.

---

## Desktop UI Features

- `DEC-23` **File display**: Project and Reference Material directory listings exclude `meta.yaml` files from display, showing only user-created files. The `meta.yaml` file is still synced and managed by the app but is not presented to the user as browsable.
- `DEC-24` **Tags page**: Aggregates and displays all tagged objects including habits.
- `DEC-25` **Modal-based editor**: The object viewer/editor in the desktop UI is a modal dialog instead of a side panel. This gives other views more horizontal space and improves mobile/tablet responsiveness. Modal sizes follow Material-UI conventions (e.g., `md`, `lg`).
- `DEC-26` **Calendar grid**: Days are rendered with fixed widths (all seven columns equal width) using CSS `gridTemplateColumns: repeat(7, 1fr)`, regardless of content size. This ensures consistent, predictable calendar layout.
- `DEC-27` **Hard delete with sync safety**: Delete operations (`puzzlepkm delete ...` and desktop UI delete flows) are hard deletes for sync-tracked objects. Before removing the local DB record, PuzzlePKM attempts to delete the corresponding sync file/folder path. If the object is known to have a remote copy (`sync_state.has_remote_copy = 1`) and sync is not connected, the delete operation fails instead of silently creating a local-only delete.
- `DEC-28` **Daily Note non-overwrite**: Daily Note creation is strict-non-overwriting. The `write daily-note` path only updates when an explicit existing `id` is provided; if another note already exists for the selected `date`, creation fails. In the desktop "Create New Note" modal, selecting a date that already has a Daily Note automatically opens that existing note instead of saving over it.
- `DEC-29` **Topic Note optional date**: Topic Notes support an optional `date` field that can be set, changed, or cleared. The value is persisted in metadata, round-tripped in front matter, and included in list metadata so Topic Notes with dates render in calendar views.
- `DEC-30` **Design system consistency**: The desktop UI uses the existing Material UI-based component stack for shared surfaces and form controls. TailwindCSS may be used for supplemental styling, but shared interactive UI primitives should align with the Material UI stack to avoid design-system fragmentation.
- `DEC-31` **Date picking**: Desktop date entry uses `@mui/x-date-pickers` and persists dates as local `YYYY-MM-DD` strings in object metadata, while rendering them in a human-friendly format in the UI.
- `DEC-32` **Render crash guardrails**: For link-navigation bugs that present as a blank screen, treat as a potential render crash first, not only a path-resolution failure. Required guardrails: (1) null-safe access for optional TipTap extension storage, (2) error boundaries around modal editor surfaces (`NotesPage`, `CalendarPage`, `TagsPage`), and (3) modified-link interception that prevents native browser navigation in editor content.
- `DEC-33` **Async sync queueing**: Save/delete actions in `ObjectEditor` queue sync as a short-delay background task instead of triggering immediate sync. Manual sidebar sync remains immediate. This preserves eventual consistency while reducing perceived save latency and UI contention.

---

## Block-Level Linking Architecture

- `DEC-34` **Block identity & linking format**: Each paragraph-level block in a note body is assigned a stable `blockId` of the form `blk-<12 lowercase hex characters>` (e.g., `blk-a1b2c3d4e5f6`), generated once at first persist and embedded as a trailing HTML comment (e.g., `text <!-- blk-a1b2c3d4e5f6 -->`). Canonical block ordering is document order (top-to-bottom). Link target format is `syncPath#blockId`. Lifecycle: (a) **update** — edits do not change `blockId`; (b) **delete** — incoming links become dangling; app surfaces warnings but does not auto-redirect; (c) **merge** — surviving upper block retains `blockId`, lower block's id discarded; (d) **split** — upper block retains original `blockId`, lower block receives new `blockId`; (e) **move across files** — `blockId` preserved, `syncPath` in links updated to reflect new location.
- `DEC-35` **`note_blocks` schema**: A `note_blocks` table stores ordered blocks for both `topic-note` and `daily-note` objects. Columns: `note_id TEXT` (FK), `block_id TEXT` (per DEC-34), `note_type TEXT` (`'topic-note'` or `'daily-note'`), `position INTEGER` (zero-based), `content_markdown TEXT`, `created_at TEXT`, `updated_at TEXT`. Primary key: `(note_id, block_id)`. Indexes: `idx_note_blocks_note_id`, `idx_note_blocks_position`. A `backfillNoteBlocks` function runs on every `openDb()` call and idempotently creates a single seed block from `content_markdown` for any note with no entries in `note_blocks` yet.
- `DEC-36` **Block round-trip for sync**: Sync serialization (`listDailyNotesForSync`, `listTopicNotesForSync`) assembles markdown body from `note_blocks` via `assembleMarkdownFromBlocks` rather than reading `content_markdown` directly. This ensures block IDs are always embedded. The `syncPath` field is included in sync list results. Sync/import parsers return a `blocks` field from `parseBlocksFromMarkdown(body)` so downstream operations use pre-parsed blocks. Create/update commands accept an optional `blocks` input; when present, it takes priority over re-parsing. Legacy markdown without embedded block IDs receives fresh block IDs per DEC-34.
- `DEC-37` **Migration hardening**: Startup backfill parses `content_markdown` into paragraph blocks (preserving valid embedded `blockId` comments), seeds an empty block only when content is blank, and skips malformed rows with actionable errors instead of aborting. Startup also runs `note_blocks` integrity repair: block IDs must match DEC-34 format and be unique per note; positions are normalized to contiguous order; malformed IDs are regenerated without dropping content.
- `DEC-38` **Block-authoritative content**: `note_blocks` is the canonical persisted source for note body content. Create/update flows persist only normalized blocks to `note_blocks`. Read and sync paths derive `contentMarkdown` from ordered blocks via `assembleMarkdownFromBlocks`.

---

## Note Identity & Lifecycle

- `DEC-39` **Daily Note date immutability**: A Daily Note is permanently anchored to its `date` (`YYYY-MM-DD` in local date semantics). After creation, updates may change content/tags/links/metadata but must not mutate the note's date identity. Moving journal content to another date is modeled as creating/reusing the target date's Daily Note.
- `DEC-40` **Topic Note Index tag**: Topic Notes may optionally be designated as Index notes by tagging with `Index`. Detection is case-insensitive (`index` match on normalized tag names), while display preserves stored tag casing. UI/filtering logic must treat the note as Index if and only if at least one normalized tag equals `index`; no other implicit rules confer Index behavior.
- `DEC-41` **Reciprocal backlinks**: Note comments are represented as regular notes linked to a target note (or block target when available) via explicit links. Backlinks are derived relationship views from persisted explicit links and must stay reciprocal for both Daily and Topic notes: adding/removing/editing a source link updates the corresponding backlink set on save. Backlinks do not mutate note identity fields (such as Daily Note date from DEC-39).
- `DEC-42` **Habit lifecycle**: Habits persist a required `status` enum with values `planned` or `accomplished`. New habits default to `planned`; habit imports/sync front matter missing `status` default to `accomplished`. Habit writes enforce a one-tag rule by persisting at most one tag. Habit metadata/list/front matter payloads include `status` for CLI and desktop bridge parity.
- `DEC-43` **Date-link semantics**: Dates are first-class links to Daily Notes. When a note link resolves to a date, or an object date field (Topic Note `date`, Habit `date`, Project `startDate`/`endDate`) is set, PuzzlePKM creates/reuses the corresponding Daily Note and persists the link so backlinks remain reciprocal. Daily Notes may be deleted only when empty and unreferenced (no content, tags, links, or backlinks). When date links are cleared, PuzzlePKM auto-cleans orphan Daily Notes that satisfy the same empty/unreferenced rule.

---

## Sync Features & Navigation

- `DEC-44` **Inbox tagging for imports**: When sync reconciliation discovers a previously unseen object (any type), it automatically adds the reserved `Inbox` tag so users can review new arrivals. Updates to existing objects never reapply `Inbox`. For habits (subject to one-tag rule of DEC-42), `Inbox` is prepended and becomes the sole stored tag. The Notes page provides an Inbox toggle button that filters all columns to show only `Inbox`-tagged items.
- `DEC-45` **Pinned navigation**: Objects tagged with reserved `Pinned` (case-insensitive) appear in a dedicated **Pinned** sidebar section beneath primary navigation. The pinned list is mixed-type, opens the target object directly on click, supports mouse drag/drop plus keyboard-accessible up/down reordering, and persists that order locally in `localStorage` (`puzzlepkm:pinned-order:v1`). Unpinning removes the `Pinned` tag immediately and persists via the existing `write` path.
- `DEC-46` **Multi-tab Notes workspace**: Notes modal editing supports multiple open object tabs (topic-note, daily-note, habit, plus linked project/ref-material targets). Opening an object reuses an existing tab by default; users can intentionally open another tab via Ctrl/Cmd-open. Each tab tracks its own dirty state and close confirmation. Active-tab selection is preserved while Notes section remains mounted. Tab state is in-memory and resets on full app reload/section remount.
- `DEC-47` **Navigation IA**: The primary sidebar has five destinations: **Calendar** (date picker + prev/next + calendar of date-bearing objects), **Library** (search/filter/sort/new + Inbox toggle; maps to Notes workspace with topic-note/daily-note/habit columns), **Scripture** (ordered scripture objects), **Tags** (aggregate tag view), **Graph** (visual link graph). The "Files" route is retained as an internal destination reachable via pinned project/ref-material items but is not surfaced as a primary nav entry. Settings remains accessible at sidebar bottom.

---

## Scripture & Product Branding

- `DEC-48` **Scripture extraction**: On create/update save for Topic and Daily notes, note block markdown is deterministically normalized to canonical scripture markdown links (`[Reference](https://www.biblegateway.com/passage/?search=...&version=RSVCE&interface=print)`). Canonicalized references are persisted in a dedicated `scriptures` table, linked to notes through `object_links`, and exposed as a first-class `scripture` object type. Scripture listing is ordered by canonical Bible book sequence then reference text, and scripture detail payloads include linked notes.
- `DEC-49` **PuzzlePKM naming**: User-facing branding uses **PuzzlePKM** across CLI help, docs, and desktop chrome. CLI usage is `puzzlepkm` and database overrides use `PUZZLEPKM_DB_PATH`. App-data directories remain `puzzlepkm`, and the desktop bundle identifier is `com.puzzlepkm.desktop`.

---

## Performance & Scale

- `DEC-50` **SQLite scale recommendation**: Synthetic benchmark runs at multi-thousand-object scale remain within acceptable local-first latency on built-in SQLite after index/query hardening (batched list hydration; composite `object_links` indexes; `updated_at` list-order indexes). Continue with SQLite as the default datastore and only investigate alternatives if routine list/search/save paths regress beyond ~150ms at current scale or if sync throughput requirements change materially.

---

## Release Criteria & Mobile


- `DEC-51` **v1 readiness**: v1 is release-ready when: (a) all object types pass regression (create/read/update/delete without data loss); (b) sync safety holds across one-shot and watch-mode sync for all object types, including safe fallback on missing folders and correct Inbox-tag application for new imports; (c) migration flows complete without data loss; (d) canonical documentation is internally consistent — command lists in `README.md` and `AGENTS.md` are identical, all `DEC-*` references resolve, and no behavioral rule is duplicated across canonical files. The actionable release checklist lives in `README.md`.
- `DEC-52` **iOS companion app**: A write-only iPhone app (`ios/`) lets users capture daily notes and habits on the go. The app writes to a `mobile-inbox/` sub-folder inside the sync root: daily notes to `{rootFolder}/mobile-inbox/daily-notes/YYYY-MM-DD.md` and habits to `{rootFolder}/mobile-inbox/habits/{date}-{tag}-{shortId}.md`. Each file uses minimal YAML front matter with `source: "mobile"` as the type discriminator. When `puzzlepkm sync` runs, `reconcileMobileInboxDailyNotes` and `reconcileMobileInboxHabits` process the files: daily-note content is *appended* to existing notes for the same date (or a new note is created), habits are imported as new entries, and processed inbox files are deleted. The iOS app is implemented in SwiftUI (iOS 17+) using SwiftyDropbox SDK. Setup instructions are in `ios/README.md`.
- `DEC-53` **CLI modular architecture slice**: `cli.mjs` is a thin entrypoint (direct-execution check + `main` delegation), while command routing is handled by modular handlers in `cli/commands/` (`notes`, `objects`, `settings`, `sync`) and domain/persistence logic remains centralized in `cli/app.mjs` for incremental extraction. This preserves command contracts while enabling smaller follow-up refactor slices.

---
