---
"puzzlepkm": patch
---

Fix Markdown task lists being silently converted to plain bullets by the editor.

`- [ ]` and `- [x]` lines loaded as ordinary bullets with the checkbox dropped, and saving wrote them back to Markdown without it — so opening a note containing tasks and saving it destroyed them, and the toolbar's Task list button never persisted anything. The editor's Markdown renderer and its HTML-to-Markdown serializer each used a task-list format the other did not recognise; both now speak the same one, and a round-trip test covers it.
