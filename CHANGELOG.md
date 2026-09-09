# puzzlepkm

## 1.6.0

### Minor Changes

- ddbb6a9: Rework habits from dated checkboxes into repeated practices with a log of occurrences.

  - A habit is now the practice itself — a name, an optional target interval, and whether it is active or retired — and each time you do it you log a dated occurrence. The `planned`/`accomplished` status is gone: logging means it happened, and PuzzlePKM derives whether a practice is due.
  - Cadence comes from the habit's target interval when you set one, and otherwise from the **median of your own observed gaps**, so a habit reports something useful without you having to guess a number. Each habit shows the gap since its last occurrence, the gaps between past ones, and whether it is on track, due, or overdue.
  - Habits live in a collapsible **Habits** panel inside the daily note. It opens by itself on days when a habit is due or was logged, and stays collapsed otherwise. Logging is one click; the panel is also where habits are created, edited, retired, and brought back, and where each one's full history is shown with the interval between every occurrence.
  - Consistency is always measured _as of the note's date_, so opening an older daily note shows what was true then rather than what is true now.
  - The Library shows one card per practice instead of one per occurrence, and opens it into a read-only view of its whole log. The Calendar keeps a marker on every date something was logged; clicking one opens that day's note.
  - Existing habits migrate automatically. Old rows group into practices by their tag (falling back to their text), each accomplished row becomes an occurrence, tags and daily-note backlinks carry over, and rows that were only ever `planned` are dropped as the intentions they were.
  - Sync moves to one Markdown file per practice — `habits/confession-4f2a1b3c.md`, with the log as a dated list in the body — instead of one file per occurrence. Existing per-occurrence files are folded into the matching practice on the next sync and removed, so the folder converges on its own.
  - Habits accept multiple tags now. The one-tag rule existed because the tag carried the habit's identity; a habit has a name for that.
  - New CLI commands: `habit list [--as-of YYYY-MM-DD] [--include-retired]`, `habit log`, and `habit unlog`.
  - Over MCP, `set_habit` now manages the practice (create, rename, set interval, retire), the new `log_habit` records or removes an occurrence, and `get_habit_log` reports cadence, gaps, and due state per habit rather than streaks over identical text.

- a6fb978: Make the contents of documents in project and reference-material folders searchable.

  - Every sync walks those folders recursively and extracts the text of the files it can read — PDFs, Word documents (`.docx`/`.docm` and legacy `.doc`), PowerPoint decks (`.pptx`/`.pptm`), Pages documents, Markdown, and plain text — into a full-text index. Extraction is keyed on size and modification time, so a file is parsed once per version and later syncs cost one `stat` per file. A `.pages` package directory is indexed as the single document it looks like.
  - The Library search now matches file contents. A match appears as its own **Document** card, showing the file name, the project or reference material holding it, and a snippet around the hit; clicking opens the file in whatever application the system uses for it. "Documents" is a Library object-type filter, on by default.
  - New CLI commands: `documents search`, `documents index [--force]`, `documents list`, and `documents status`.
  - The MCP server gains `search_documents`, `get_document_text`, and `list_documents`, and `search_knowledge_base` now returns document hits alongside notes and objects.
  - Extraction is written against Node built-ins only, keeping the CLI dependency-free: a ZIP reader for the Office XML formats, a Compound File Binary reader plus piece-table walk for `.doc` (fast-saved documents included), and a PDF reader that resolves object streams and maps character codes through each font's `/ToUnicode` CMap so subset-font exports from Word, Pages, and browsers read as text rather than glyph noise.
  - Files that are understood but hold no text — scanned PDFs, image-only decks, and Pages 5+ documents saved without a preview — index as empty with the reason recorded, and `documents list` reports it per file.

- 21ff244: Add tasks, and refine habits with cadence modes, calendar creation, and deletion.

  **Tasks.** Markdown checkboxes written in daily and topic notes are now gathered into one place. A task is just a line in your note — nothing separate is stored — and `due:2026-09-15` anywhere in that line sets a due date, hidden from the text when displayed.

  - The Library's **Inbox** button now shows tasks above the `Inbox`-tagged items it showed before. Soonest and overdue first, undated below, recently completed at the bottom.
  - Tick a task to complete it, click its text to edit the wording or the due date, and hover a row for a button that opens the note it came from, scrolled to that exact line. A capture line at the top adds a task to today's daily note.
  - Editing always rewrites the line in the note that owns it, so there is never a second copy to fall out of step. Lines inside fenced code blocks are left alone.
  - A task you complete stays in the Inbox for three days so you can see and undo it. A task PuzzlePKM finds already ticked — written that way, or completed in another editor — is simply done and never appears.
  - Daily note cards in the Library show a badge counting their incomplete tasks.
  - New CLI commands: `tasks list`, `tasks add`, and `tasks set`.

  **Habits.**

  - A habit can now be set to **don't track — record only**: it keeps its history and its observed rhythm but never becomes due. Previously any habit with enough history eventually read as overdue, which was wrong for a practice you want a record of but no longer keep up. It stays loggable, which is what distinguishes it from retiring.
  - Habits can be created from the **Calendar**'s new-item menu, which offers to log an occurrence on the date you were looking at.
  - A habit can be **deleted** from its card in the Library, behind a confirmation naming it and its occurrence count. That removes it and its whole log everywhere, including its Markdown file. Retiring remains the non-destructive option.

### Patch Changes

- d933cde: Fix Markdown task lists being silently converted to plain bullets by the editor.

  `- [ ]` and `- [x]` lines loaded as ordinary bullets with the checkbox dropped, and saving wrote them back to Markdown without it — so opening a note containing tasks and saving it destroyed them, and the toolbar's Task list button never persisted anything. The editor's Markdown renderer and its HTML-to-Markdown serializer each used a task-list format the other did not recognise; both now speak the same one, and a round-trip test covers it.

- 533b367: Keep a task in the Inbox for three days whichever way you tick it.

  Completing a task from the Inbox recorded when it happened, so the task lingered as intended; ticking the same checkbox in the note itself did not, so it vanished from the Inbox immediately. Both are you finishing something in the app, and both now behave the same way.

  A task PuzzlePKM finds already done still never appears — one written as `- [x]`, or ticked in another editor and picked up by sync. The distinction is no longer where you ticked it, but whether the app was there for the moment it was finished.

- 4a1403b: Stop sync from re-importing notes forever when a file's link list has gone stale.

  A note file records `linkedObjectIds`, but the database derives that field from the note's content and ignores whatever the file says. When the two disagreed — normally because a linked object had been deleted — sync compared them, decided the file was different, re-imported it, derived the same value again, and left the timestamp untouched. The file was never rewritten, so the next sync did exactly the same thing. Nine notes were being rewritten on every single sync, and the summary always claimed "updated: 9" when nothing had changed.

  Sync no longer compares that derived field. A genuine change to a note's links comes from its content, date, or scripture references, all of which are still compared.

## 1.5.0

### Minor Changes

- Group scripture references by chapter and rebuild the graph around them.

  - Chapters are a first-class object type. A reference now records the chapters it spans and the verse span within each, so every note citing anywhere in Mark 10 rolls up to one chapter instead of scattering across nine verse-level records.
  - The graph draws scripture as chapters, sized by citing notes and coloured by canonical section. Nodes with no edges are hidden behind a "Show unlinked" toggle, and searching shows a match plus its direct neighbours.
  - A chapter view lists every citation grouped by verse span, with the notes that used each reference and links to the adjacent chapters.
  - Scripture detection no longer reads prose as citations ("Feeding of the 5,000" had become Thessalonians 5,000), rejects volume-less numbered books, understands Douay-Rheims 3/4 Kings, handles single-chapter books such as Jude, and stops a verse list from swallowing the volume of the citation after it.
