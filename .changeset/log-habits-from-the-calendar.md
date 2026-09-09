---
"puzzlepkm": minor
---

Log an existing habit from the calendar instead of creating a new one every time.

Adding a habit from a day almost always means "this practice happened today" — but the calendar's only offer was **New Habit**, so recording Tuesday's Examen minted a second Examen rather than logging the one already being tracked. The menu item is now **Log Habit…**, opening the habits already kept, measured as of the selected day: filter by name, click to log an occurrence, click again to remove it. Creating a habit is still there as the deliberate second step, and whatever was typed into the filter carries through as the new habit's name.

Alongside it, several layout fixes:

- The Inbox's **Tasks** card no longer breaks across a column of the gallery, which was slicing it in half and leaving the seam without corners or padding. It sits above the cards at full width, collapses to a single row when it is in the way, and lists tasks in up to three columns.
- The **Calendar** month grid fills the window rather than stopping partway down, and picking a date in the jump picker — or a dated search result — now moves the calendar to that month, which it previously failed to do.
- Spacing is corrected across the app. A stylesheet rule was overriding every margin utility in the app, so a good deal of intended spacing had never actually applied; with that fixed, the object editor and the navigation sidebar were retuned to sit right.
