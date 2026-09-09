---
"puzzlepkm": minor
---

Linked folders survive a restore, and a link that points nowhere can be repaired.

A linked folder used to leave no trace in the sync root — the registration lived only in the local database — so restoring your knowledge base on another Mac silently lost every linked project and reference material. Linking the folder again there did not bring the object back either: it created a new one, with none of the original's tags or links.

Each link now publishes a small record to `linked-sources/` in the sync root: the object's name, tags and the path it was linked at, never the folder's contents, which stay outside the sync root as before. A restore brings the project or reference material back as **an object with a broken link** — everything except the files: the object, its tags, its links from notes, and the document text already indexed.

A link is broken whenever nothing is at the recorded path — the folder moved, its drive is not mounted, or the path only ever existed on another machine. **Settings → Linked directories** marks those **Unavailable** and offers **Relink…**, and the object's own page shows the same repair banner. Relinking keeps the object: same id, same tags, same links. On the CLI it is `sources relink <path-or-id> <new-path>`, and `sources list` says which links need it.

Removing a link is called **Unlink** everywhere now, never Delete — the object and its tracking go, and the folder stays on disk exactly as it was. Unlinking on one device unlinks it on the others, and touches no one's folder.
