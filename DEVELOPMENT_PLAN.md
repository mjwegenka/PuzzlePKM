# PuzzlePKM Development Plan

This file is the single source of truth for **delivery order and stage boundaries**.
Do not restate domain rules here; reference:
- `README.md` for product/domain scope
- `IMPLEMENTATION_DECISIONS.md` for implementation decisions (`DEC-*`)

Stage status should be updated here first, then summarized elsewhere only as a pointer.

## Goal
Deliver a local-first CLI knowledge management tool with local-folder sync, plus a desktop wrapper that invokes CLI functionality through Tauri.

## Completed Stages (1–8)

Stages 1 through 8 have been fully implemented:

- **Stage 1 – Scope Lock**: Product scope and decision log are internally consistent.
- **Stage 2 – Architecture Baseline**: CLI data/model boundaries, local schema, and sync boundaries are established.
- **Stage 3 – Runnable Foundation**: CLI CRUD works locally and the repository remains runnable without desktop shell dependencies.
- **Stage 4 – Domain Linking Core**: All MVP object schemas implemented. ID-based links and bi-directional reference resolution are in place. Daily Note uniqueness by local date is enforced.
- **Stage 5 – Notes Workflows**: Markdown import pipeline and core note/object workflows are available in the CLI.
- **Stage 6 – Sync File Objects**: Projects and Reference Materials are sync-backed as slug-named directories with `meta.yaml`. Directory browsing and open-in-folder helpers are in CLI and desktop UI (`DEC-17`, `DEC-23`).
- **Stage 7 – Habits and Tags**: Habit lifecycle enforces single-tag identity and required `status` enum (`DEC-45`). Case-insensitive tags aggregate across all object types. Tags page lists all tagged objects including habits (`DEC-24`).
- **Stage 8 – Sync and Reliability**: Local-folder sync is the active transport (`DEC-35`, `DEC-41`). One-shot `puzzlepkm sync` and background `puzzlepkm sync --watch` are available. Conflict resolution follows last-write-wins semantics (`DEC-09`). Legacy provider-auth commands are now deprecated.

## Block-Level Note Linking (Completed)

The full block-level linking feature set has been implemented:

- Block identity and link target format (`DEC-36`)
- `note_blocks` persistence schema and migration scaffolding (`DEC-37`)
- Block round-trip for sync/import/export (`DEC-38`)
- Migration hardening for legacy block rollout (`DEC-39`)
- Block-authoritative note content reads/writes (`DEC-40`)
- Local-sync naming cleanup (`DEC-41`)
- Daily Note date identity immutability (`DEC-42`)
- Topic Note Index-tag semantics (`DEC-43`)
- Note backlink expectations (`DEC-44`)
- Habit lifecycle + single-tag identity (`DEC-45`)
- Date-link semantics + Daily Note lifecycle guardrails (`DEC-46`)
- Inbox tagging for sync imports + Inbox view (`DEC-47`)
- Pinned navigation special-tag + local ordering (`DEC-48`)
- Notes workspace multi-tab behavior (`DEC-49`)
- Target v1 navigation IA (`DEC-50`)
- Scripture extraction/linking object graph (`DEC-51`)
- PuzzlePKM product rename compatibility (`DEC-52`)
- SQLite scale recommendation for v1/v1.1 (`DEC-53`)

## Stage 9: Release Readiness
Status: **Current**

See `DEC-54` in `IMPLEMENTATION_DECISIONS.md` for the full v1 readiness definition.

### v1 Validation Checklist

**Regression**
- [ ] All object types (daily-note, topic-note, habit, project, ref-material, scripture) can be created, read, updated, and deleted via CLI without data loss.
- [ ] `note_blocks` backfill runs idempotently on `openDb()` for all legacy notes; malformed rows emit warnings and do not abort startup.
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
- [ ] `syncPath` metadata is present and correct in serialized front matter; legacy path aliases round-trip for compatibility.

**Migration flows**
- [ ] Opening a pre-block-era database auto-backfills `note_blocks` from `content_markdown` without data loss.
- [ ] Legacy markdown without embedded block IDs receives fresh block IDs on import; no content is dropped.
- [ ] Legacy path-field links resolve after migration to the local-sync transport (`DEC-35`).
- [ ] `PUZZLEPKM_DB_PATH` and legacy `PUZZLEPKM_DB_PATH` environment variables both resolve to the correct database.
- [ ] `puzzlepkm` primary CLI and `puzzlepkm` compatibility alias both resolve to the same binary.

**Documentation**
- [ ] Command lists in `README.md` and `AGENTS.md` are identical and cover all runnable commands.
- [ ] All `DEC-*` references in `README.md` resolve to entries in `IMPLEMENTATION_DECISIONS.md`.
- [ ] No behavioral rule appears in more than one canonical file (see canonical ownership in `AGENTS.md`).
- [ ] `DEVELOPMENT_PLAN.md` stage statuses match actual implementation state.

Exit criteria: all checklist items pass and the release candidate satisfies `DEC-54`.

## iOS Mobile Companion App
Status: **Implemented** (DEC-55)

A write-only iPhone app (`ios/`) lets users capture daily notes and habits on the go and sync them back to the desktop via a `mobile-inbox/` sub-folder in the configured sync root.

### What was shipped

- SwiftUI app (iOS 17+) with three tabs: **Daily Note**, **Habits**, and **Settings**.
- Dropbox authentication via the SwiftyDropbox OAuth SDK.
- Daily notes are written to `{rootFolder}/mobile-inbox/daily-notes/YYYY-MM-DD.md`.
- Habits are written to `{rootFolder}/mobile-inbox/habits/{date}-{tag}-{shortId}.md`.
- Desktop `puzzlepkm sync` processes mobile inbox files:
  - Daily notes are **appended** to existing notes for the same date (or a new note is created).
  - Habits are imported as new entries.
  - Processed inbox files are deleted from the sync folder.
- Xcode setup instructions and file format reference in `ios/README.md`.
- Implementation decision recorded as `DEC-55` in `IMPLEMENTATION_DECISIONS.md`.

## Desktop UI Contract Plan (Tauri Desktop Shell)
Status: **Planned**

Desktop version in this repo means the responsive shell behavior defined in `HEPTABASE_INTERFACE_CHANGE_PLAN.md`, hosted in a Tauri wrapper.

### Stage 10: Token + Theme Foundation
- Map contract tokens into a single source (`src/theme.ts` + CSS variables): color, typography, radius, shadow, focus, motion, layout.
- Implement global rules: body colors/font, focus-visible outline, selection color, form control baseline (including min text size rules).
- Add reusable primitives matching contract semantics: page container, section card, toolbar, control row/control, banner, modal shell.
- Exit criteria: primitives render with contract token values and no ad-hoc style values are needed for core screens.

### Stage 11: Desktop Shell + Navigation
- Implement desktop sidebar shell for `>=768` with contract width, backdrop, active/inactive nav states, and brand card.
- Keep mobile bottom nav behavior for `<768`; desktop hides bottom nav and shifts content to sidebar layout.
- Preserve responsive defaults from contract: desktop default calendar view is `month`, segmented selectors on desktop.
- Exit criteria: shell matches contract behavior across breakpoints and keyboard focus states are fully visible.

### Stage 12: Desktop Calendar Views
- Build desktop-first calendar modes in priority order: `month` -> `standard` -> `wide`.
- Implement month grid rules (7 columns, in/out-of-month states, today highlighting, event chip styles).
- Implement wide mode horizontal tracks, min widths, and edge-paging intent/cooldown behavior.
- Add conflict panel and floating action button styling/positioning per contract.
- Exit criteria: calendar interactions and layout parity are achieved for desktop breakpoints.

### Stage 13: Modal + Form Contracts
- Implement modal sizes (`md`, `2xl`) and shared header/body/actions pattern.
- Implement subscribe modal sections and copy-feedback behavior (`Copied!` timing/state).
- Implement create/edit event modal field sets, busy labels, conditional sections, and read-only synthetic notice treatment.
- Align disabled/readonly visual states with contract values.
- Exit criteria: modal UX and state transitions match contract rules and are keyboard accessible.

### Stage 14: Parity Validation + Hardening
- Add visual parity checks for desktop breakpoints (snapshot or Playwright screenshot baseline for shell/calendar/modals).
- Add interaction tests for non-visual contract behaviors: date navigation semantics, special-filter navigation disablement, readonly event constraints.
- Run accessibility checks (focus order, contrast, modal trapping, keyboard-only navigation).
- Exit criteria: contract coverage checklist passes and regressions are blocked in CI for desktop UI surfaces.
