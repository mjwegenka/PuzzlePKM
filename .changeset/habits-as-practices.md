---
"puzzlepkm": minor
---

Rework habits from dated checkboxes into repeated practices with a log of occurrences.

- A habit is now the practice itself — a name, an optional target interval, and whether it is active or retired — and each time you do it you log a dated occurrence. The `planned`/`accomplished` status is gone: logging means it happened, and PuzzlePKM derives whether a practice is due.
- Cadence comes from the habit's target interval when you set one, and otherwise from the **median of your own observed gaps**, so a habit reports something useful without you having to guess a number. Each habit shows the gap since its last occurrence, the gaps between past ones, and whether it is on track, due, or overdue.
- Habits live in a collapsible **Habits** panel inside the daily note. It opens by itself on days when a habit is due or was logged, and stays collapsed otherwise. Logging is one click; the panel is also where habits are created, edited, retired, and brought back, and where each one's full history is shown with the interval between every occurrence.
- Consistency is always measured *as of the note's date*, so opening an older daily note shows what was true then rather than what is true now.
- The Library shows one card per practice instead of one per occurrence, and opens it into a read-only view of its whole log. The Calendar keeps a marker on every date something was logged; clicking one opens that day's note.
- Existing habits migrate automatically. Old rows group into practices by their tag (falling back to their text), each accomplished row becomes an occurrence, tags and daily-note backlinks carry over, and rows that were only ever `planned` are dropped as the intentions they were.
- Sync moves to one Markdown file per practice — `habits/confession-4f2a1b3c.md`, with the log as a dated list in the body — instead of one file per occurrence. Existing per-occurrence files are folded into the matching practice on the next sync and removed, so the folder converges on its own.
- Habits accept multiple tags now. The one-tag rule existed because the tag carried the habit's identity; a habit has a name for that.
- New CLI commands: `habit list [--as-of YYYY-MM-DD] [--include-retired]`, `habit log`, and `habit unlog`.
- Over MCP, `set_habit` now manages the practice (create, rename, set interval, retire), the new `log_habit` records or removes an occurrence, and `get_habit_log` reports cadence, gaps, and due state per habit rather than streaks over identical text.
