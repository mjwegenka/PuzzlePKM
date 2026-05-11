# Dropith Development Plan

This file is the single source of truth for **delivery order and stage boundaries**.
Do not restate domain rules here; reference:
- `README.md` for product/domain scope
- `IMPLEMENTATION_QUESTIONS.md` for implementation decisions (`DEC-*`)

Stage status should be updated here first, then summarized elsewhere only as a pointer.

## Goal
Deliver a CLI-first local-first knowledge management tool with Dropbox sync. The CLI (`cli.mjs`) is the primary interface — all features must be usable without Electron. The Electron desktop UI is a secondary, optional interface that may not be actively maintained.

## Completed Stages (1–5)

Stages 1 through 5 have been fully implemented:

- **Stage 1 – Scope Lock**: Product scope and decision log are internally consistent.
- **Stage 2 – Architecture Baseline**: Electron main/renderer boundaries, IPC contracts, Zustand state, and Dropbox auth/sync boundaries are established.
- **Stage 3 – Runnable Foundation**: Electron app boots, CRUD works locally, auth flow is wired. CLI runs standalone.
- **Stage 4 – Domain Linking Core**: All MVP object schemas implemented. ID-based links and bi-directional reference resolution are in place. Daily Note uniqueness by local date is enforced.
- **Stage 5 – Notes Editing UX**: Topic and Daily editors built on TipTap v3. Mentions, backlinks, and cross-object autocomplete are stable. Markdown import pipeline is available in the CLI.

## Stage 6: Dropbox File Objects
Status: **In progress** (directory browsing + open-in-Dropbox app/web wiring implemented)
- Implement Projects and Reference Materials directory browsing.
- Add open-in-default-app behavior from desktop shell.
- Support optional project date metadata.
- Exit criteria: Dropbox-backed objects are navigable and launchable.

## Stage 7: Habits and Tags
Status: **In progress** (Habits view + aggregate Tag object view implemented)
- Implement Habit constraints (`DEC-09`).
- Implement case-insensitive tags + alias behavior (`DEC-08`).
- Build aggregate tag views across object types.
- Exit criteria: habits/tags behave consistently across all linked objects.

## Stage 8: Sync and Reliability
Status: **In progress** (manual + periodic auto-sync fully available in CLI; Electron UI also exposes sync controls and diagnostics)
- Implement auto-sync + manual sync controls (`DEC-12`) — available via `dropith sync` and `dropith sync --watch`
- Implement conflict detection + user-guided resolution (`DEC-13`)
- Add sync diagnostics with content-safe logging (`DEC-19`)
- Exit criteria: offline edits survive reconnect and conflict paths are explicit.

## Stage 9: Release Readiness
- Reach target domain coverage threshold (`DEC-21`).
- Run regression passes for data loss and sync correctness.
- Package and validate macOS release artifacts.
- Exit criteria: release candidate satisfies `DEC-22` readiness definition.
