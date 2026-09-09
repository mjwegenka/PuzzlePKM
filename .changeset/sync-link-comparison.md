---
"puzzlepkm": patch
---

Stop sync from re-importing notes forever when a file's link list has gone stale.

A note file records `linkedObjectIds`, but the database derives that field from the note's content and ignores whatever the file says. When the two disagreed — normally because a linked object had been deleted — sync compared them, decided the file was different, re-imported it, derived the same value again, and left the timestamp untouched. The file was never rewritten, so the next sync did exactly the same thing. Nine notes were being rewritten on every single sync, and the summary always claimed "updated: 9" when nothing had changed.

Sync no longer compares that derived field. A genuine change to a note's links comes from its content, date, or scripture references, all of which are still compared.
