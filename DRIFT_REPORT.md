# Drift Audit Report

Date: 2026-05-23  
Scope: `src/App.tsx`, all `src/components/**/*.tsx`, `src/theme.ts`, `src/lib/objectColors.ts`, `src/index.css`

## Audit criteria

1. **Color drift**: UI surfaces still using legacy blue literals (for example `#0e2038`, `#1a8ab5`, `#7dbad6`, `#1c3558`, `#4a6a8a`) instead of the neutral dark theme tokens in `src/theme.ts` (`neutralDarkTokens` / theme palette keys).
2. **Terminology drift**: UI text using Heptabase-style wording (especially “card”) instead of PuzzlePKM terminology from README/plan/decisions (object types like Daily Note, Topic Note, Habit, Project, Reference Material).

## Executive summary

- The app is in a **mixed state**: some newer surfaces are tokenized/neutral (for example `FilterChip`, `NoteCard`, parts of `NavigationSidebar`), but many pages/components still hardcode the old blue palette.
- Terminology drift is concentrated in the **Library (`NotesPage`) UX**, where user-facing strings repeatedly use **“card”** language.
- Primary navigation label **Library** is **not drift** (it is aligned with `DEC-50`).

## High-confidence drift findings

### A) Legacy blue color scheme still present

Representative files/lines (not exhaustive):

- `src/App.tsx:244-267` (app shell/background/tab bar: `#0b1828`, `#0e2038`, `#1c3558`, `#1a8ab5`, `#e4f0fb`)
- `src/components/SettingsPage.tsx:161-180`, `173` (header/icon and section paper colors)
- `src/components/TagsPage.tsx:152-239` (section surfaces/chips/selections)
- `src/components/CalendarPage.tsx:250-378` (calendar surfaces/borders/day states)
- `src/components/GraphPage.tsx:129-219` (graph container, node/link colors)
- `src/components/RichMarkdownEditor.tsx:368-373`, `864-885` (toolbar and active states)
- `src/components/ObjectEditor.tsx:562-603`, `723-770` (labels/chips/containers)
- `src/components/NewNotePage.tsx:51-95` (header, segmented control, panel)
- `src/components/FileExplorer.tsx:88-177`, `201-255` (panel/list rows)
- `src/components/ObjectDirectoryBrowser.tsx:88-130` (panel/list rows)
- `src/components/MentionPopup.tsx:23-26`, `86-124` (popup and type color constants)
- `src/components/CalendarView.tsx:82-140` (legacy panel + day colors)
- `src/components/ObjectList.tsx:50-131` (panel and separators)
- `src/components/ScripturePage.tsx:94-260` (loading/list/detail styles)

Additionally:

- `src/lib/objectColors.ts:17-23` still defines blue-heavy canonical per-type colors, which amplifies legacy visual tone on chips/badges across surfaces.

### B) Heptabase-style terminology drift in UI copy

User-visible strings in `src/components/NotesPage.tsx`:

- `689`: `"Card type"`
- `734`: `"Find a card..."`
- `764`: `aria-label="Sort cards"`
- `796`, `804`: `"Create a new card"`
- `824`: button text `"+Card"`
- `834`: `aria-label="Create card type"`
- `852`: `"Create a dated habit card"`

Potentially mismatched phrasing:

- `846`: `"Create or open a dated journal entry"` (README and decisions consistently use **Daily Note** terminology).

## Components that appear aligned with neutral token usage

These files predominantly use theme palette/token-based styling and did not show the same old-blue literal pattern during this audit:

- `src/components/ui/FilterChip.tsx`
- `src/components/ui/NoteCard.tsx`
- `src/components/NavigationSidebar.tsx` (main palette definitions are neutral token-based)

## Terminology alignment notes

- `Library` label is aligned with current app IA (`DEC-50`) and should stay.
- The strongest terminology drift is specifically the repeated “card/cards” language in Library actions/filters/placeholders.

## Suggested follow-up work (separate implementation issue)

1. Replace remaining hardcoded blue literals with `theme.palette.*` / `neutralDarkTokens` references.
2. Decide whether `objectColors` should be rebalanced toward neutral accents while keeping object-type distinction.
3. Rename Library UI copy from “card” to app-native wording (for example “note” or “item/object”), then run a consistency pass for ARIA labels/tooltips/placeholders.

