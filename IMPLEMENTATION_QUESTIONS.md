# Implementation Decisions Log

This file is the single source of truth for **implementation decisions**.
Use stable IDs (`DEC-xx`) in code comments, PRs, and planning notes to avoid drift.

## Product and Platform Decisions
- `DEC-01` MVP includes all object types from `README.md` with emphasis on CRUD + linking first.
- `DEC-02` v1 target platform is macOS.
- `DEC-03` App must work offline and sync later when network is available.
- `DEC-04` Initial keyboard shortcuts: `Cmd+K`, `Cmd+N`, `Cmd+S`, `Cmd+E`, `Cmd+Shift+F`.

## Data Model Decisions
- `DEC-05` Links are ID-based for integrity, with optional path metadata for display.
- `DEC-06` Daily Note uniqueness uses local timezone calendar date.
- `DEC-07` MVP notes support linking to files/images (no embedded binary content).
- `DEC-08` Tags are case-insensitive; aliases/synonyms are supported.
- `DEC-09` Habit text must remain under 256 chars (max 255); values over limit are truncated and warning is shown.

## Dropbox and Sync Decisions
- `DEC-10` User can select any Dropbox root folder; app may suggest a default layout.
- `DEC-11` Dropbox auth tokens must be stored in platform secure storage (macOS Keychain for v1).
- `DEC-12` Sync model is both auto-sync and manual sync.
- `DEC-13` Conflicts use automatic merge when safe, otherwise explicit user choice/manual merge.
- `DEC-14` Reference Material history is Dropbox-native, with optional in-app metadata for UX.

## Editor and Interop Decisions
- `DEC-15` TipTap v1 includes basic rich text + mentions + backlinks; advanced blocks can follow later.
- `DEC-16` Cross-object links should support autocomplete and preview.
- `DEC-17` Markdown import/export is required in v1.

## Superseding Decisions
- `DEC-23` (supersedes `DEC-11`) Secret storage uses legacy desktop safe storage with an app-managed local encrypted store, rather than a native keychain addon.
- `DEC-24` (supersedes `DEC-15`) Editor baseline uses current TipTap v3 packages while keeping scope constraints the same: rich text + mentions + backlinks first, advanced blocks later.

## Security and Privacy Decisions
- `DEC-18` No encryption-at-rest requirement for local cache/metadata in v1.
- `DEC-19` Telemetry/logging must exclude note content and other user-identifying content data.
- `DEC-20` No explicit compliance program required at this stage.

## Testing and Release Decisions
- `DEC-21` Target at least 80% automated coverage for core domain logic before first release.
- `DEC-22` "Ready to build" means: domain scope, architecture, sync policy, editor scope, and test expectations are all explicitly documented.

## Dropbox Note Storage Decisions
- `DEC-25` Daily notes are stored in Dropbox at `{rootFolder}/daily-notes/YYYY-MM-DD.md`. Filename encodes the date, making each file uniquely addressable.
- `DEC-26` Topic notes are stored at `{rootFolder}/topic-notes/{slug}-{shortId}.md`. Slug is derived from the title (max 60 chars, lowercase alphanumeric with hyphens); shortId is the first 8 characters of the note UUID to avoid collisions.
- `DEC-27` All note metadata (id, type, date/title, tags, linkedObjectIds, createdAt, updatedAt) is stored as YAML front matter in each Markdown file. Tags are stored as display names (human-readable). The Markdown body follows the front matter.
- `DEC-28` Dropbox is the canonical source of truth. When a daily note is loaded by date and Dropbox is connected, the app first fetches the Dropbox version. If the Dropbox `updatedAt` is more recent than the local DB version, the local DB is updated from Dropbox. If the note exists locally but not in Dropbox, it is pushed to Dropbox in the background. Dropbox failures fall back to the local DB without blocking the UI.
- `DEC-29` Consistency checks (reconcile DB with Dropbox) run in the background on every manual or periodic auto-sync trigger. For each note type, Dropbox files not in DB are imported; DB records not in Dropbox are uploaded. Per DEC-28, Dropbox wins on conflict (newer `updatedAt`). The default Dropbox root folder is `/Dropith` if no root folder is configured.

## Update Rules
- Append new decisions; do not rewrite prior decisions silently.
- If a decision changes, add a new decision entry that supersedes the old ID and reference both IDs.
- Keep `README.md` as product/domain source, and keep this file focused on implementation behavior.

## CLI-First Decisions
- `DEC-30` (supersedes `DEC-02`) The primary interface is the CLI (`cli.mjs`), which runs standalone with Node.js 22+ (no build step). All features — CRUD, Dropbox OAuth, one-shot sync, and background sync daemon — are available in the CLI. A desktop shell may exist as a secondary interface.
- `DEC-31` (supersedes `DEC-23`) Secret storage uses the app-managed local `secrets.json` store shared by the CLI and companion tooling. Legacy desktop safe-storage APIs are not required for current architecture.
- `DEC-32` (supersedes `DEC-30`) The supported product surface remains the CLI (`cli.mjs`). Any companion UI must invoke CLI-safe functionality and avoid direct dependency on legacy desktop IPC APIs.
- `DEC-33` (supersedes `DEC-29`) Sync tracks whether a note has previously had a Dropbox copy. When the relevant Dropbox note folder can be listed successfully, a previously synced note that is now missing from Dropbox is deleted locally instead of being recreated. Notes that have never been synced are uploaded normally. If the Dropbox note folder itself is missing, the folder is treated as non-authoritative and local notes are left unchanged to avoid accidental mass deletion.
- `DEC-34` Desktop web-shell implementation must conform to `UI_Design_Contract.json` for tokens, responsive behavior, component states, and calendar interaction semantics at `>=768px` breakpoints.
- `DEC-35` Desktop packaging and command execution host use Tauri. The desktop wrapper delegates object/auth/sync operations to `cli.mjs` command execution so desktop and terminal surfaces share one behavioral implementation.
