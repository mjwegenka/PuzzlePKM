---
"puzzlepkm": minor
---

Add tasks, and refine habits with cadence modes, calendar creation, and deletion.

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
