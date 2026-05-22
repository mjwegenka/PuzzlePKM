# PuzzlePKM -> Heptabase-Like Library UI Change Plan (Screenshot-Based)

This document compares the two provided screenshots and lists concrete UI changes to make PuzzlePKM look and behave like the Heptabase library interface.

- Source A: PuzzlePKM screenshot (blue 3-column list view)
- Source B: Heptabase screenshot (dark card-library board)
- Constraint: AI-specific features are ignored per request.
- Scope: Visual structure, layout, controls, and interaction patterns visible in screenshots.

## 1) Highest-impact structural changes

### 1.1 Replace the center content from "3 list columns" to "card board"
Current PuzzlePKM (A):
- Three equal columns: Topic Notes, Daily Notes, Habits.
- Each column is a vertical list with thin row separators and a filter input.

Target Heptabase-like (B):
- One unified, multi-column card board (masonry-style visual result).
- Cards of varying heights, each showing rich preview content.
- No visible split by object type columns.

Required changes:
- Replace per-type column containers with a single board container.
- Render notes as cards in a grid/masonry layout.
- Remove column headers and column-local filter inputs.
- Add board-level sorting/filtering controls (chips) above cards.

### 1.2 Replace the Notes page hero header with compact toolbar controls
Current PuzzlePKM (A):
- Large page title "Notes" with subtitle.
- Action button "New Note" on right.

Target Heptabase-like (B):
- Compact top control bar with:
  - Search input (left)
  - "+ Card" action button near search
  - Horizontal filter chips row
  - Small utility icon(s) at right
- No large page heading in content region.

Required changes:
- Remove large title/subtitle block from top of page content.
- Add persistent toolbar with search + chips + create action.

## 2) Left sidebar changes

### 2.1 Convert sidebar from app-navigation-first to library-workspace-first
Current PuzzlePKM (A):
- Vertical app nav: Calendar, Library, Scripture, Tags, Graph.
- Separate pinned area and settings footer.
- Strong blue background blocks.

Target Heptabase-like (B):
- Sidebar starts with compact top controls and a segmented tab bar.
- "Upload sources" row and search icon button.
- Object collections list with icons (Inbox, Journal, Whiteboard, Card Library, etc.).
- Nested section header ("Default") with item list below.
- "New tab" entry in section list.
- Utility/update panel at bottom.

Required changes:
- Shift visual priority from large app sections to compact workspace controls.

### 2.2 Sidebar visual style updates
Current PuzzlePKM (A):
- Thick blue selection bands and brighter cyan accents.
- Spacious nav rows with large icon/text emphasis.

Target Heptabase-like (B):
- Neutral dark gray palette.
- Tighter row heights.
- Softer hover and selected states.
- More subdued icon color; text gains emphasis only on selection.

Required changes:
- Reduce row height and internal padding.
- Use low-contrast borders and hover fills.
- Use rounded selection pill/row style instead of large bright block highlight.

## 3) Top toolbar and controls changes

### 3.1 Search control
Current PuzzlePKM (A):
- No global search bar in Notes content area.

Target Heptabase-like (B):
- Prominent search field at top: "Find a card..."

Required changes:
- Add global board search input.
- Place at top-left of toolbar, before chips.
- Add keyboard shortcut support later (not visible in screenshot, but common expectation).

### 3.2 Primary create button style
Current PuzzlePKM (A):
- "New Note" filled blue button, right-aligned in page header.

Target Heptabase-like (B):
- Smaller "+ Card" dark outlined/tonal button near search.

Required changes:
- Replace or restyle action button to compact toolbar style.
- Rename from note-centric text to card-centric text if matching target language exactly.

### 3.3 Filter chips row
Current PuzzlePKM (A):
- Only an inbox toggle icon in header.
- Per-column text filters.

Target Heptabase-like (B):
- Horizontal chip set with dropdown affordances:
  - Card type
  - Tags
  - Untagged
  - Custom
  - + New filter

Required changes:
- Implement board-level chip filters in one row.
- Each chip uses rounded pill, icon + label + optional caret.
- Keep chips horizontally scrollable when width is limited.
- Replace column-level filter model with board-level filter model.

## 4) Main content rendering changes

### 4.1 Card shell appearance
Current PuzzlePKM (A):
- Row items with minimal preview text and hard dividers.

Target Heptabase-like (B):
- Rounded rectangular cards with:
  - Subtle border
  - Dark tonal background
  - Comfortable inner padding
  - Vertical spacing between cards

Required changes:
- Add card component with target radius and border treatment.
- Remove hard row divider look from primary content zone.

### 4.2 Card content hierarchy
Current PuzzlePKM (A):
- Usually title/date + short plain preview.

Target Heptabase-like (B):
- Rich hierarchy per card:
  1. Small day-of-week label (red accent)
  2. Large date/title line
  3. Body snippet with list bullets/links/highlights
  4. Optional media preview

Required changes:
- Expand preview renderer to preserve rich markdown cues (lists, links, emphasis).
- Add metadata line style matching target hierarchy.
- Add optional thumbnail/media area for notes containing media.

### 4.3 Multi-height board layout behavior
Current PuzzlePKM (A):
- Fixed-height list rows in fixed columns.

Target Heptabase-like (B):
- Card heights vary based on content length.
- Board visually resembles masonry/waterfall columns.

Required changes:
- Use CSS masonry-like approach or JS layout logic for variable-height cards.
- Keep consistent card width per board breakpoint.
- Preserve vertical rhythm and gutters.

## 5) Color, spacing, and typography deltas

### 5.1 Color system
Current PuzzlePKM (A):
- Blue-heavy palette (`#0e2038` style surfaces, cyan accents).

Target Heptabase-like (B):
- Neutral charcoal/dark gray palette with selective accent colors:
  - Red for weekday metadata
  - Blue/cyan only for links/selected controls
  - Green highlight for marked text only

Required changes:
- Introduce neutral-dark semantic tokens for background/surface/border/text.
- Reduce global cyan usage to avoid current "all-blue" look.

### 5.2 Typography scale
Current PuzzlePKM (A):
- Header/title text is dominant; list rows compact and uniform.

Target Heptabase-like (B):
- Cards use larger, more expressive title/date text.
- Secondary metadata and snippets have clearer size contrast.

Required changes:
- Define card typography tokens:
  - metadata caption
  - card title/date display
  - snippet body
- Reduce oversized page header typography (or remove page header).

### 5.3 Spacing and density
Current PuzzlePKM (A):
- Tight list rows, narrow content padding in each column.

Target Heptabase-like (B):
- More breathing room in cards and between controls.
- Dense but not cramped filter/control row.

Required changes:
- Increase card internal padding.
- Standardize gutters between columns/cards.
- Tighten top control rows while expanding content card spacing.

## 6) Selection, hover, and interaction feedback

### 6.1 Hover behavior
Current PuzzlePKM (A):
- Row hover with subtle blue tint.

Target Heptabase-like (B):
- Card hover appears as slight tonal/lift emphasis (subtle).

Required changes:
- Add card hover state (background/border/shadow micro-shift).
- Keep transitions short and low-contrast.

### 6.2 Selection behavior
Current PuzzlePKM (A):
- Selected list row highlighted strongly in column.

Target Heptabase-like (B):
- Selection is less visually loud, integrated with card style.

Required changes:
- Use card-level selected border/glow, not full-row block fill.

### 6.3 Scroll behavior and affordances
Current PuzzlePKM (A):
- Independent scroll in each list column.

Target Heptabase-like (B):
- Single board scroll area for all cards.

Required changes:
- Consolidate to one primary scroll container in content area.
- Keep sidebar independently scrollable.

## 7) Information model presentation changes (UI only)

Current PuzzlePKM (A):
- Type separation is explicit (Topic/Daily/Habit columns).

Target Heptabase-like (B):
- Content appears unified; type is filterable, not physically separated.

Required changes:
- Render all notes in one library board by default.
- Expose type segmentation via filter chips (e.g., "Card type").
- Preserve current object types under the hood; change only presentation layer.

## 8) Bottom utility/status area differences

Current PuzzlePKM (A):
- "Synced just now" row and Settings button at bottom of sidebar.

Target Heptabase-like (B):
- Utility/announcement panel (update card) plus bottom icon dock.

Required changes:
- Convert bottom area to compact utility stack:
  - status/notifications panel
  - tiny icon dock actions
- Keep sync status but present in subdued utility card style.

## 9) Screenshot-accurate visual details to replicate

1. Rounded panel corners are more pronounced than PuzzlePKM lists.
2. Border contrast is very low but consistent on cards and chips.
3. Top filter chips are all pill-shaped and horizontally aligned.
4. Search field and +Card button appear in same visual line.
5. Cards have mixed content patterns (title-only, bullets, rich text, image preview).
6. Weekday labels use warm/red accent while most text remains neutral.
7. Sidebar section headers are compact and uppercase/small-ish with muted color.
8. Sidebar entries can include count badges and small glyph icons.
9. Main canvas feels like a board, not a table/list.

## 10) Suggested implementation breakdown in this repo

Likely primary files to change:
- `src/components/NavigationSidebar.tsx`
- `src/components/NotesPage.tsx`
- `src/components/ObjectList.tsx` (if reused for card board)
- `src/index.css`
- `src/theme.ts`

Recommended phases:

### Phase 1: Layout skeleton
- Replace Notes header + 3-column body with:
  - compact top toolbar
  - unified board container
- Refactor sidebar into grouped workspace sections.

### Phase 2: Visual system
- Add neutral-dark theme tokens.
- Implement chip/search/button style system.
- Implement card shell with proper radius/border/padding.

### Phase 3: Interaction model
- Convert filtering to board-level chip filters.
- Add single-scroll board behavior.
- Add card hover/selection states.

### Phase 4: Rich card preview
- Improve note preview rendering (lists, links, excerpt fidelity).
- Add optional media preview blocks for image-containing notes.

## 11) Acceptance checklist ("looks like Heptabase" gate)

- [ ] No 3-column per-type list layout remains in Library/Notes view.
- [ ] A top toolbar with search + compact create button + pill filters is present.
- [ ] Main content is a unified card board with variable card heights.
- [ ] Sidebar is reorganized into workspace-style grouped controls.
- [ ] Palette is neutral charcoal-first, not blue-first.
- [ ] Card typography hierarchy (metadata -> large title/date -> snippet) is implemented.
- [ ] Scrolling behavior matches board paradigm (single board scroll in content).
- [ ] Hover/selection affordances are subtle and card-native.

## 12) Notes on certainty

This document is intentionally screenshot-driven.
- It is highly accurate for visible UI structure and styling differences.
- It does not claim hidden functionality not shown in screenshots.
- AI-specific interface elements were excluded from requirements as requested.

