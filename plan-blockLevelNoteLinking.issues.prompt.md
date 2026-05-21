## Issue Sequence: Block-Level Linking + Product Roadmap

### Issue 1 - Decide block/link contract and record `DEC-*`
**Goal**
Define the canonical block model and link target format before schema work.

**Scope**
- Add a new decision entry in `IMPLEMENTATION_DECISIONS.md`.
- Choose and document:
  - block identity (`blockId`) format and stability rules
  - block ordering model
  - link target format (recommended: `dropboxPath#blockId`)
  - behavior when a block is deleted/merged/split
- Add a short implementation note in `README.md` pointing to the decision (no behavior duplication).

**Acceptance Criteria**
- New `DEC-*` is appended (no history rewrite).
- Link format and block lifecycle rules are explicit and unambiguous.
- Docs remain canonical and non-duplicative.

**Depends on**
- None

---

### Issue 2 - Add `note_blocks` persistence and migration scaffolding
**Goal**
Introduce block storage without breaking existing note reads/writes.

**Scope**
- In `cli.mjs`, add schema for `note_blocks` table keyed by `note_id` + `block_id`.
- Add supporting indexes (e.g., by `note_id`, `position`).
- Add migration/backfill scaffold to create one block from existing `content_markdown` for legacy notes.
- Keep `topic_notes.content_markdown` and `daily_notes.content_markdown` intact.

**Acceptance Criteria**
- Existing data opens with no loss.
- New table exists and can store ordered blocks for both note types.
- Backfill scaffold runs safely and idempotently.

**Depends on**
- Issue 1

---

### Issue 3 - Add CLI block-aware CRUD with dual-write
**Goal**
Make `write/get/list` block-aware while preserving legacy compatibility.

**Scope**
- Update note read/write internals in `cli.mjs`:
  - read blocks when present
  - write blocks for note updates/creates
  - dual-write `content_markdown` from blocks during transition
- Keep `write` command behavior stable for callers.
- Add helper functions to normalize, order, and persist blocks atomically.

**Acceptance Criteria**
- `dropith write topic-note ...` and `dropith write daily-note ...` continue to work.
- `get` returns block data for notes while still supporting legacy markdown consumers.
- Save/update operations are transactional and deterministic.

**Depends on**
- Issue 2

---

### Issue 4 - Update sync/import/export for block round-trip
**Goal**
Ensure file sync and import/export continue to round-trip with block-backed notes.

**Scope**
- Update markdown parse/serialize flows in `cli.mjs` (`dailyNoteToMarkdown`, `topicNoteToMarkdown`, related parsers).
- Define how blocks serialize to markdown body and how markdown imports map back to blocks.
- Preserve existing front matter behavior and link compatibility.

**Acceptance Criteria**
- Existing synced notes remain readable.
- Updated notes can sync without corruption.
- Importing legacy markdown creates valid block data.

**Depends on**
- Issue 3

---

### Issue 5 - Extend shared types and CLI bridge payloads
**Goal**
Make desktop data contracts explicitly support blocks.

**Scope**
- Update `src/shared/types.ts` note interfaces to include block arrays.
- Update `src/lib/cliService.ts` parsing/typing for note responses.
- Keep fallback path for notes that only have legacy markdown during migration window.

**Acceptance Criteria**
- TypeScript builds cleanly with block fields.
- UI receives typed block data without breaking existing screens.
- Legacy fallback remains functional.

**Depends on**
- Issue 3

---

### Issue 6 - Refactor editor to edit blocks and create block-targeted links
**Goal**
Enable block-level editing and linking in desktop UI.

**Scope**
- Refactor `src/components/ObjectEditor.tsx` and `src/components/RichMarkdownEditor.tsx` to work with ordered blocks.
- Add/retain stable block IDs through edit operations.
- Update mention/link insertion to target `dropboxPath#blockId`.
- Keep current shift-click navigation behavior compatible with block anchors.

**Acceptance Criteria**
- Users can create/edit/reorder blocks in note editors.
- Links can target individual blocks and resolve correctly.
- Save flow remains non-blocking and sync queue behavior is unchanged.

**Depends on**
- Issue 5

---

### Issue 7 - Backfill rollout and transition hardening
**Goal**
Ship migration safely with clear transition guardrails.

**Scope**
- Implement startup backfill for pre-existing notes lacking blocks.
- Keep dual-write for one release window.
- Add integrity checks for block ordering/ID uniqueness.
- Add error handling for malformed legacy note data.

**Acceptance Criteria**
- Existing users are migrated automatically without manual steps.
- No data loss during first-run migration.
- Known bad/malformed rows fail gracefully with actionable errors.

**Depends on**
- Issues 4, 6

---

### Issue 8 - Remove legacy single-field write path and finalize docs
**Goal**
Complete migration and reduce maintenance burden.

**Scope**
- Deprecate direct reliance on note-level `content_markdown` as primary source.
- Keep read fallback only if required by backward compatibility policy decided in Issue 1.
- Update docs (`README.md`, `IMPLEMENTATION_DECISIONS.md`, optionally `DEVELOPMENT_PLAN.md`) to reflect completion.

**Acceptance Criteria**
- Block data is the authoritative content source.
- Legacy behavior is either removed or intentionally retained with documented reason.
- Documentation reflects final architecture and stage status.

**Depends on**
- Issue 7

---

### Issue 9 - Remove Dropbox naming and components (local-first sync only)
**Goal**
Align product, code, and UI with local-folder sync and remove legacy Dropbox surface area.

**Scope**
- Remove deprecated auth/connect UI and CLI messaging tied to Dropbox APIs.
- Rename path fields and labels from `dropboxPath` to neutral local-sync naming in code and docs.
- Keep data migration compatibility for existing DB rows/front matter values.

**Acceptance Criteria**
- No user-facing Dropbox auth/connect actions remain.
- Local-folder sync is the only sync mode described in UI/help/docs.
- Existing user data with legacy path fields remains readable.

**Depends on**
- Issue 8

---

### Issue 10 - Daily Note and Topic Note domain semantics (`DEC-*`)
**Goal**
Codify Daily Notes as fixed-in-time journal entries and Topic Notes as optional Index notes.

**Scope**
- Add `DEC-*` entries in `IMPLEMENTATION_DECISIONS.md` for:
  - Daily Note immutability around date identity
  - "Index" special tag behavior on Topic Notes
  - note-comment/backlink expectations
- Add concise pointers in `README.md` (no duplicate behavior text).

**Acceptance Criteria**
- Domain semantics are explicit and canonical.
- "Index" tag behavior is unambiguous for UI and filtering.

**Depends on**
- Issue 1

---

### Issue 11 - Link/backlink graph refresh on note save
**Goal**
Keep explicit links and backlinks synchronized from note content.

**Scope**
- Parse note links on save for Topic and Daily notes.
- Upsert direct links and reciprocal backlinks in metadata/graph tables.
- Remove stale links/backlinks when links are deleted from content.
- Render links/backlinks at the bottom of note views.

**Acceptance Criteria**
- Each save produces accurate forward/backward relationships.
- Link graph converges after edits without duplicates.
- Notes display related objects in a stable order.

**Depends on**
- Issues 6, 10

---

### Issue 12 - Date-link semantics and Daily Note lifecycle guardrails
**Goal**
Treat dates as first-class links to Daily Notes with safe auto-create/auto-delete behavior.

**Scope**
- Linking to a date creates (or reuses) that Daily Note and records backlinks.
- Enforce delete rules:
  - auto-delete Daily Notes with no content, links, or backlinks
  - prevent delete when content/links/backlinks exist
- Make all date fields create/maintain date links consistently.

**Acceptance Criteria**
- Date links always resolve to one Daily Note per local date.
- Empty/unreferenced Daily Notes are cleaned up automatically.
- Non-empty or referenced Daily Notes cannot be removed until cleared.

**Depends on**
- Issue 11

---

### Issue 13 - Add Reference Material optional `author`
**Goal**
Support optional author metadata for Reference Materials across CLI, storage, sync, and UI.

**Scope**
- Add schema/migration for `author` field.
- Update CRUD, list output, front matter/meta serialization, and UI forms.
- Add library filters/sort support for author.

**Acceptance Criteria**
- `author` is optional and round-trips cleanly.
- Existing records remain valid with no backfill requirement.
- Search/filter can include author.

**Depends on**
- Issue 9

---

### Issue 14 - Inbox tagging for new sync imports + Inbox view
**Goal**
Automatically tag newly imported objects as `Inbox` and provide a dedicated review surface.

**Scope**
- On sync import of previously unseen objects, add special tag `Inbox`.
- Add Inbox page/view and an Inbox toggle in Library toolbar.
- Ensure updates to existing objects do not reapply Inbox unless configured.

**Acceptance Criteria**
- Only newly discovered synced objects receive `Inbox`.
- Users can review Inbox items in a focused view.
- Inbox filter behavior is predictable across object types.

**Depends on**
- Issue 9

---

### Issue 15 - Pinned objects via special tag + manual ordering
**Goal**
Add a pinned navigation section based on a special tag and user-defined order.

**Scope**
- Define special pinned tag behavior.
- Add "Pinned" section below primary nav entries.
- Support drag/drop reorder and persist order locally.
- Add hover affordance to unpin (remove special tag).

**Acceptance Criteria**
- Pin/unpin operations are instant and persistent.
- Drag/drop reorder is keyboard/mouse accessible and stable.
- Pinned list supports mixed object types.

**Depends on**
- Issue 14

---

### Issue 16 - Multi-tab object workspace
**Goal**
Allow opening multiple objects simultaneously in tabs.

**Scope**
- Open objects in new tabs regardless of object type.
- Preserve tab state (active tab, dirty indicator, close behavior).
- Support opening same object intentionally in a new tab when requested.

**Acceptance Criteria**
- Users can work across object types side-by-side in tabs.
- Tab lifecycle is predictable and does not lose unsaved changes.
- Routing/state restore behavior is documented.

**Depends on**
- Issue 15

---

### Issue 17 - Consistent object-type color tokens across app
**Goal**
Use one canonical color mapping per object type for all major UI surfaces.

**Scope**
- Define object-color tokens in theme layer.
- Apply tokens to tabs, chips/cards, nav items, and contextual badges.
- Validate contrast/accessibility in dark/light variants used by app.

**Acceptance Criteria**
- Each object type has one consistent color identity.
- Tabs and list cards/chips visually align with that identity.
- Contrast meets accessibility baseline for text/icon usage.

**Depends on**
- Issue 16

---

### Issue 18 - Navigation refactor (Calendar, Library, Scripture, Tags, Graph placeholder)
**Goal**
Restructure the app shell navigation for the target v1 information architecture.

**Scope**
- Implement target pages:
  - Calendar (date picker + prev/next + calendar of date-bearing objects)
  - Library (search/filter/sort/new + Inbox toggle)
  - Scripture (ordered scripture objects)
  - Tags
  - Graph placeholder (future surface)
- Align sidebar/nav behavior and routing state.

**Acceptance Criteria**
- New nav destinations are complete and reachable.
- Library toolbar supports required controls.
- Graph route exists as an explicit placeholder.

**Depends on**
- Issues 14, 17

---

### Issue 19 - Scripture extraction/linking engine + Scripture object type
**Goal**
Parse scripture references from notes, normalize them, and manage a dedicated Scripture object graph.

**Scope**
- Port/replace `scripturelink.js` behavior into maintained parsing service.
- On save, detect and normalize scripture references in Topic/Daily note content.
- Insert canonical scripture links (Bible Gateway URL format).
- Add new `scripture` object type that can link to multiple notes sharing the same reference.
- Add Scripture page ordering by canonical Bible book sequence.

**Acceptance Criteria**
- Equivalent references normalize to one Scripture object.
- Save-time link insertion is deterministic and consistent.
- Scripture objects show passage link and linked notes.

**Depends on**
- Issues 11, 18

---

### Issue 20 - Local sync folder settings management
**Goal**
Allow users to edit the local folder location from Settings.

**Scope**
- Add Settings UI control to view/update sync root folder.
- Validate path input and show effective resolved path.
- Ensure subsequent sync/read/write operations use new location safely.

**Acceptance Criteria**
- Users can change local sync folder without manual file edits.
- Invalid paths are rejected with actionable errors.
- Existing data remains intact through folder change workflow.

**Depends on**
- Issue 9

---

### Issue 21 - SQLite scale assessment and performance hardening
**Goal**
Validate SQLite suitability at "thousands of objects" scale and optimize if needed.

**Scope**
- Build benchmark dataset and repeatable performance harness.
- Measure key operations (list, get, search, save, sync reconcile, backlink refresh).
- Add indexes/query improvements and document thresholds.
- Produce "stay on SQLite vs investigate alternative" recommendation with evidence.

**Acceptance Criteria**
- Benchmark script and results are reproducible.
- Top slow queries are identified and improved.
- Recommendation is documented with tradeoffs.

**Depends on**
- Issues 11, 18

---

### Issue 22 - Product rename to `PuzzlePKM`
**Goal**
Rename product and package surfaces from Dropith to PuzzlePKM.

**Scope**
- Update user-facing app name, CLI help text, docs, and branding assets.
- Plan compatibility aliases (CLI command, config path, migration messaging) to avoid disruption.
- Update desktop wrapper naming and package identifiers where safe.

**Acceptance Criteria**
- Primary branding and docs use PuzzlePKM.
- Existing users are not broken by abrupt command/path changes.
- Compatibility strategy is documented.

**Depends on**
- Issue 20

---

### Issue 23 - v1 readiness: documentation and validation pass
**Goal**
Prepare documentation and release checks for v1 after feature completion.

**Scope**
- Update canonical docs:
  - `README.md` (product truth)
  - `IMPLEMENTATION_DECISIONS.md` (`DEC-*` trail)
  - `DEVELOPMENT_PLAN.md` (stage status)
- Add validation checklist for regression, sync safety, and migration flows.
- Ensure command lists are synchronized across docs.

**Acceptance Criteria**
- Docs reflect implemented behavior with no contradictory rules.
- v1 checklist is explicit and actionable.
- Canonical ownership rules are respected.

**Depends on**
- Issues 12, 13, 19, 21, 22

---

## Suggested Labels
- `area:cli`
- `area:desktop-ui`
- `area:data-model`
- `area:sync`
- `migration`
- `needs-decision`
- `area:navigation`
- `area:performance`
- `area:docs`
- `area:branding`
- `area:scripture`

## Milestone Suggestion
- Milestone 1: `Block-level linking foundation` (Issues 1-8)
- Milestone 2: `Local-first product expansion` (Issues 9-21)
- Milestone 3: `PuzzlePKM v1 readiness` (Issues 22-23)

