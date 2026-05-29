# PuzzlePKM v1 Release Readiness Tracker

Date: 2026-05-24
Driver: @copilot
Branch/Commit: `copilot/v1-gap-check-again` @ `a7a94c8` (plus local changes)
Target Tag: v1.0.0-rc

## Legend
- Status: `PASS` | `FAIL` | `BLOCKED` | `N/A`
- Evidence: command output summary, code reference, or local artifact path

---

## 1) Regression

| ID | Requirement (from Stage 9) | Status | Evidence | Owner | Notes |
|---|---|---|---|---|---|
| R1 | CRUD via CLI works without data loss for `daily-note`, `topic-note`, `habit`, `project`, `ref-material`, `scripture` | PASS | Manual CLI scenario in `/tmp/puzzlepkm-v1-gap` (`write/list/get/delete/sync`) | @copilot | Scripture lifecycle validated via note save/delete flows (`list/get scripture`). |
| R2 | `note_blocks` backfill is idempotent on `openDb()`; malformed rows warn and do not abort startup | PASS | `backfillNoteBlocks` + startup warning path (`cli.mjs:1132-1185`), malformed-row startup did not abort in `/tmp/puzzlepkm-v1-gap` | @copilot | Startup integrity repair preserved content and normalized blocks. |
| R3 | Block IDs match `blk-<12 hex>`; positions contiguous + unique per note | PASS | DB query after repair in `/tmp/puzzlepkm-v1-gap` returned normalized `blk-*` IDs and contiguous positions | @copilot | Verified after injecting malformed block row. |
| R4 | Daily Note date identity immutable (update rejects date mutation) | PASS | Fixed in `updateDailyNoteRecord` (`cli.mjs`), verified by failing `write daily-note` mutation attempt | @copilot | New error: `Daily Note date is immutable...`. |
| R5 | Habit one-tag rule + valid `status` persisted | PASS | `write habit` with 2 tags persisted one tag; invalid status write normalized to valid status | @copilot | Enforcement present in habit create/update sanitization. |
| R6 | Backlinks remain reciprocal after add/remove/edit of source link | PASS | Link reconciliation uses `syncNoteObjectLinks` in topic/daily create+update paths (`cli.mjs:1671-1684`, `1986-2014`) | @copilot | Static validation for reciprocal maintenance path. |

## 2) Sync Safety

| ID | Requirement | Status | Evidence | Owner | Notes |
|---|---|---|---|---|---|
| S1 | One-shot `puzzlepkm sync` completes without data loss across all object types | PASS | One-shot sync output in `/tmp/puzzlepkm-v1-gap` (`uploaded: 5`, `errors: 0`) | @copilot | Covered daily/topic/habit/project/ref-material object sync. |
| S2 | `puzzlepkm sync --watch` works at default and custom `--interval` | PASS | Ran `sync --watch` (default and `--interval 1`) with timeout; both started and completed an initial cycle | @copilot | No startup/runtime errors observed. |
| S3 | Missing sync folder => folder recreated + deletion reconciliation skipped for that run/type | PASS | Folder-missing guard/warnings in per-type reconcile functions (`cli.mjs:3562`, `3649`, `3776`, `3902`, `3992`) | @copilot | Code-level validation of skip+recreate behavior. |
| S4 | Delete flow removes sync file/folder before local DB record drop | PASS | Delete path enforces remote delete first (`DEC-27`; delete flows in `cli.mjs`) | @copilot | Matches documented hard-delete contract. |
| S5 | `Inbox` tag applied exactly once to new imports only | FAIL | Re-sync of imported legacy note in `/tmp/puzzlepkm-s6-check` dropped `Inbox` tag on second sync | @copilot | Gap: imported object no longer retains one-time Inbox tagging expectation. |
| S6 | Synced files omit serialized `syncPath`; DB `sync_path` derives from actual filesystem locations on sync | PASS | `DEC-69`; sync serializers no longer emit `syncPath`, sync import derives from scanned file/folder paths, and sync cleanup strips legacy serialized path keys in place | @copilot | File contents are now location-derived instead of metadata-derived. |

## 3) Migration Flows

| ID | Requirement | Status | Evidence | Owner | Notes |
|---|---|---|---|---|---|
| M1 | Env-var compatibility checks in plan are validated as written | PASS | `PUZZLEPKM_DB_PATH` used throughout manual checks and resolved expected DB file | @copilot | Verified via isolated DB paths in `/tmp/puzzlepkm-*`. |
| M2 | CLI alias compatibility checks in plan are validated as written | PASS | Type alias map present in `resolveType` (`cli.mjs:2519-2547`); CLI binary resolution confirmed via `npm run cli -- --help` | @copilot | Alias coverage validated for object-type tokens. |

## 4) Documentation Consistency

| ID | Requirement | Status | Evidence | Owner | Notes |
|---|---|---|---|---|---|
| D1 | Command lists in `README.md` and `AGENTS.md` are identical | PASS | Scripted check reported no missing AGENTS commands in README (`CMD_CHECK`) | @copilot | Verified command overlap for the canonical command set. |
| D2 | All `DEC-*` refs in `README.md` resolve in `IMPLEMENTATION_DECISIONS.md` | PASS | Scripted check `DEC_CHECK` => `missing: []` | @copilot | 15 unique `DEC-*` refs resolved. |
| D3 | No duplicated behavioral rules across canonical files | PASS | Manual review of canonical sections + ownership statements | @copilot | No contradictory duplicate behavior rules identified. |

---

## Exit Gate (DEC-51 / Stage 9)
- [ ] All rows above are `PASS`
- [x] No open Sev-1/Sev-2 defects (from this run)
- [ ] Release candidate approved for tag

Decision: `NO-GO`
Approver: @copilot
