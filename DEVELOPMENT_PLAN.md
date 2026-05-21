# Dropith Development Plan

This file is the single source of truth for **delivery order and stage boundaries**.
Do not restate domain rules here; reference:
- `README.md` for product/domain scope
- `IMPLEMENTATION_DECISIONS.md` for implementation decisions (`DEC-*`)

Stage status should be updated here first, then summarized elsewhere only as a pointer.

## Goal
Deliver a local-first CLI knowledge management tool with local-folder sync, plus a desktop wrapper that invokes CLI functionality through Tauri.

## Completed Stages (1–5)

Stages 1 through 5 have been fully implemented:

- **Stage 1 – Scope Lock**: Product scope and decision log are internally consistent.
- **Stage 2 – Architecture Baseline**: CLI data/model boundaries, local schema, and sync boundaries are established.
- **Stage 3 – Runnable Foundation**: CLI CRUD works locally and the repository remains runnable without desktop shell dependencies.
- **Stage 4 – Domain Linking Core**: All MVP object schemas implemented. ID-based links and bi-directional reference resolution are in place. Daily Note uniqueness by local date is enforced.
- **Stage 5 – Notes Workflows**: Markdown import pipeline and core note/object workflows are available in the CLI.

## Stage 6: Sync File Objects
Status: **In progress** (directory browsing + open-in-folder wiring implemented)
- Implement Projects and Reference Materials directory browsing.
- Add CLI-friendly open/browse helpers for sync-backed directories.
- Support optional project date metadata.
- Exit criteria: sync-backed objects are navigable and launchable.

## Stage 7: Habits and Tags
Status: **In progress** (Habits view + aggregate Tag object view implemented)
- Implement Habit constraints (`DEC-09`).
- Implement case-insensitive tags + alias behavior (`DEC-08`).
- Build aggregate tag views across object types.
- Exit criteria: habits/tags behave consistently across all linked objects.

## Stage 8: Sync and Reliability
Status: **In progress** (manual + periodic auto-sync fully available in CLI)
- Implement auto-sync + manual sync controls (`DEC-12`) — available via `dropith sync` and `dropith sync --watch`
- Implement conflict detection + user-guided resolution (`DEC-13`)
- Add sync diagnostics with content-safe logging (`DEC-19`)
- Exit criteria: offline edits survive reconnect and conflict paths are explicit.

## Stage 9: Release Readiness
- Reach target domain coverage threshold (`DEC-21`).
- Run regression passes for data loss and sync correctness.
- Package and validate macOS release artifacts.
- Exit criteria: release candidate satisfies `DEC-22` readiness definition.

## Desktop UI Contract Plan (Tauri Desktop Shell)
Status: **Planned**

Desktop version in this repo means the `>=768px` shell behavior defined in `UI_Design_Contract.json`, hosted in a Tauri wrapper.

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
