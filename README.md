# PuzzlePKM

<p>
  <img src="./public/icons/icon-128.png" alt="PuzzlePKM icon" width="128" height="128" />
</p>

PuzzlePKM is a local-first personal knowledge management (PKM) app with a fast CLI and a beautiful desktop interface. All of your notes, tags, habits, and materials stay in a local SQLite database and sync to a local folder you control.

---

## Features

- **Local-First & Private**: Direct SQLite storage, no remote servers, fully offline.
- **Multi-Interface**: Access your knowledge base through a fast Node.js CLI or a responsive desktop UI shell.
- **Unified Graph**: Visualizes relations between notes, tags, habits, and scriptures.
- **Automatic Backlinks**: Links between notes stay reciprocal.
- **Scripture Integration**: Automatic Bible reference extraction and linking.
- **Searchable Documents**: The text inside PDFs, Word files (`.docx` and `.doc`), PowerPoint decks, Pages documents, Markdown, and plain text in project and reference-material folders is indexed on every sync, so search reaches into the files themselves.

---

## Installation & Setup

### Requirements

- **Node.js**: Version 22 or higher is required.
- **Operating System**: macOS-first. The CLI and database use per-platform paths and run on Linux and Windows, but packaging, code signing, and the desktop shell are developed and exercised on macOS; treat the other platforms as untested.

### Quick Start

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Sync Folder (Optional)**:
   By default, PuzzlePKM syncs to `~/Library/CloudStorage/Sync/PuzzlePKM` on macOS (or `~/Sync/PuzzlePKM` as fallback). You can configure a custom sync root:
   ```bash
   npm run cli -- settings set root-folder "/path/to/your/pkm-folder"
   ```

3. **Launch the Desktop Application**:
   To run the companion desktop app in development mode:
   ```bash
   npm run tauri:dev
   ```

4. **Verify the CLI Setup**:
   ```bash
   npm run cli -- --help
   ```

---

## Working with Objects

PuzzlePKM structures your PKM data into distinct object types. You can create, manage, and query them using either the CLI or the desktop UI.

### Supported Object Types

| Object Type | Description | CLI Shortcut |
| :--- | :--- | :--- |
| `topic-note` | Free-form notes with titles and content. | `topic-note` |
| `daily-note` | Journal entries tied to a specific date. | `daily-note` |
| `habit` | A repeated practice, with a log of the dates it happened. | `habit` |
| `project` | Local folder-backed directories for projects. | `project` |
| `ref-material` | Local folder-backed directories for reference materials. | `ref-material` |
| `scripture` | Automatically parsed scripture references. | `scripture` |
| `scripture-chapter` | Chapter-level rollup of the references that cite it. | `scripture-chapter` |
| `tag` | Organization labels (case-insensitive). | `tag` |
| `link` | Internal relationships between objects. | `link` |

Tasks are deliberately absent from this table: a task is a Markdown checkbox inside a note rather than an object of its own, with no tags, no sync file of its own, and no card in the Library. See [Tasks](#4-tasks).

The files inside project and reference-material folders are indexed for search (see below), but a document is **not** an object type: it has no id in the object registry and cannot be listed, tagged, or linked. It appears only as a search result pointing at the file.

---

### How to Add New Objects

#### 1. Topic Notes
Topic Notes are standard markdown notes containing content, links, and tags.
* **Via CLI (Interactive)**:
  ```bash
  npm run cli -- create topic-note
  ```
* **Via CLI (Quick Add)**:
  ```bash
  npm run cli -- add "My new topic note body content here"
  ```
* **Via Desktop UI**: Click the **Library** tab, select **Topic Notes**, click **New Note** (or press the global shortcut), and write your note in the editor.

#### 2. Daily Notes
Daily Notes are journal entries anchored to a specific date (`YYYY-MM-DD`). Only one Daily Note can exist per calendar date.
* **Via CLI (Interactive)**:
  ```bash
  npm run cli -- create daily-note
  ```
* **Via Desktop UI**: Open the **Calendar** tab, click on any date, and begin writing. If a note already exists for that date, it opens automatically.

#### 3. Habits
A habit is a practice you repeat — Confession, an examen, spiritual direction. The habit itself carries the name, an optional target interval, and whether it is active or retired; each time you actually do it, you log a dated occurrence. PuzzlePKM works out the gap since the last one, the typical gap between them, and whether the practice is now due or overdue.

Each habit decides when it is due in one of three ways:

| Cadence | Behaviour |
| :--- | :--- |
| **Learn my rhythm** (default) | Due once the gap exceeds the median of your own observed gaps — useful without you having to guess a number. |
| **Every so many days** | Due on a schedule you set, e.g. every 30 days. |
| **Don't track — record only** | Never becomes due. For a practice you want a history of but no longer keep up, or one with no rhythm worth holding to. |

* **Via Desktop UI**: Open a daily note. The **Habits** panel sits above the note body; it opens by itself on days when something is due or was logged, and stays collapsed otherwise. Click a habit's circle to log it on that day, use **+** to create one, and a habit's **⋯** menu to see its history, change its cadence, or retire it. You can also add a habit from the **Calendar**'s new-item menu, which offers to log it on the date you were looking at. Retired habits keep their history and can be reactivated; deleting one — from its card in the Library, behind a confirmation — removes it and its whole log for good.
* **Via CLI**:
  ```bash
  npm run cli -- create habit                        # guided prompts
  npm run cli -- habit list                          # cadence, gaps, and due state as JSON
  npm run cli -- habit log Confession                # record an occurrence today
  npm run cli -- habit log Confession 2026-04-18     # …or on a given date
  npm run cli -- habit unlog Confession 2026-04-18   # remove one
  ```

#### 4. Tasks
Tasks are ordinary Markdown checkboxes written inside daily notes and topic notes. Nothing separate is stored: the task *is* the line in your note, and PuzzlePKM keeps a derived index of them so they can be gathered in one place.

```markdown
- [ ] Email the provincial due:2026-09-15
- [ ] Read Rahner chapter 3
- [x] Book flights
```

A `due:YYYY-MM-DD` anywhere in the line sets a due date and is hidden from the task's text when displayed.

* **Via Desktop UI**: Click the **Inbox** button in the Library toolbar. Tasks come first — soonest and overdue at the top, undated below, recently completed at the bottom — followed by the items sync flagged with the `Inbox` tag. Tick a task to complete it, click its text to edit the wording or its due date, and hover a row for a button that opens the note it came from, scrolled to that exact line. The capture line at the top adds a task to today's daily note. Daily note cards show a badge counting their incomplete tasks.
* **Via CLI**:
  ```bash
  npm run cli -- tasks list                              # every task, in Inbox order
  npm run cli -- tasks add "Email the provincial" --due 2026-09-15
  npm run cli -- tasks set <id> --done                   # or --undone, --text, --due, --clear-due
  ```

Editing a task always rewrites the line in the note that owns it — there is no second copy to fall out of step.

A task you complete **in PuzzlePKM** stays in the Inbox for three days, so you can see what you did and undo it — whether you ticked it in the Inbox or in the note itself. A task PuzzlePKM finds already ticked is simply done and never appears: one written as `- [x]`, or one completed in another editor and picked up by sync. The difference is whether the app was there for the moment it was finished.

#### 5. Projects
Projects are folder-backed workspaces designed to hold your local project files (source code, assets, documents) alongside PKM notes.
* **Filesystem-First Creation (Recommended)**: Simply create a subdirectory under `projects/` in your configured sync root (e.g., `projects/my-new-project/`). PuzzlePKM's sync engine will automatically discover the folder, initialize a managed `meta.yaml` metadata file, and integrate it into your Library.
* **Via CLI (Interactive)**:
  ```bash
  npm run cli -- create project
  ```

#### 6. Reference Materials
Reference Materials are folder-backed resource records (books, articles, PDFs) integrated with a database-backed author catalog.
* **Filesystem-First Creation (Recommended)**: Simply create a subdirectory under `ref-materials/` in your configured sync root (e.g., `ref-materials/book-title/`). PuzzlePKM's sync engine will automatically discover the folder, initialize a managed `meta.yaml` metadata file, and integrate it into your Library.
* **Via CLI (Interactive)**:
  ```bash
  npm run cli -- create ref-material
  ```

#### 7. Scriptures
You do not manually create scriptures! PuzzlePKM automatically scans your topic and daily note bodies for RSVCE Bible citations (e.g. `Romans 3:16`, `1 Corinthians 13:4-8`).
* **Creation**: Simply mention a valid scripture reference in a note block. On save, PuzzlePKM converts it into an internal scripture object and maintains backlinks to the source notes automatically.

#### 8. Tags
Tags organize your PKM database.
* **Via CLI**:
  ```bash
  npm run cli -- create tag
  ```
* **Implicit Creation**: Tags are automatically created when you add them to any note or object via front matter or the editor tag field.

#### 9. Links
Links represent relationships between objects.
* **Via CLI**:
  ```bash
  npm run cli -- create link
  ```
* **Implicit Creation**: Simply write internal links in note content using the `@` mention menu in the desktop editor or manual Markdown links `[Label](objectId)`.

---

### Linking folders that already exist

A project or reference material does not have to live inside the sync root. Any folder on disk can be linked as one, and PuzzlePKM will keep it where it is: linked directories are scanned on every sync and are **never** written to, renamed, or deleted by the app. Deleting the object or unlinking it leaves the folder untouched.

In the desktop app, the Library's create menu offers **Project** ("Choose a folder to add as a project") and **Reference Material**, both of which open a native folder picker. From the CLI:

```bash
npm run cli -- sources list                              # linked folders and whether they are reachable
npm run cli -- sources scan ~/Documents/Reading          # list a parent folder's subdirectories as candidates
npm run cli -- sources add ~/Documents/Reading/Augustine --type ref-material --name "Augustine"
npm run cli -- sources relink ~/Documents/Reading/Augustine ~/Archive/Augustine
npm run cli -- sources remove ~/Documents/Reading/Augustine
```

`sources add` accepts several paths at once, so a scanned parent folder can be linked in one pass. Folders inside the sync root, overlapping links, and non-directories are rejected. If a linked folder becomes unreachable — an unmounted volume, a cloud folder mid-sync — the sync warns and keeps the record and its indexed document text rather than treating the absence as a deletion.

#### Broken links, and repairing them

The link itself travels between devices, but the folder does not. Each linked directory publishes a small record to `linked-sources/` in the sync root — the object's name, tags and the path it was linked at, never the folder's contents — so restoring your knowledge base on another Mac brings the project or reference material back as **an object with a broken link** rather than losing it. A link is broken whenever nothing is at the recorded path: the folder moved, its drive is not mounted, or the path only ever existed on another machine.

A broken link keeps everything except the files: the object, its tags, its links from notes, and the document text already indexed. Sync skips the folder and warns instead of reading the absence as a deletion.

To repair one, point it at the folder again:

```bash
npm run cli -- sources list                              # "unavailable" marks a broken link
npm run cli -- sources relink <path-or-object-id> <new-path>
```

In the desktop app, **Settings → Linked directories** marks a broken link **Unavailable** and offers **Relink…**, which opens a folder picker; the object's own page shows the same repair banner. Relinking keeps the object — the same id, tags and links — which is what separates it from linking the folder afresh, since a new link would create a new object with none of that history.

Removing a link is called **Unlink** throughout, never Delete: the object and its tracking go, and the folder stays on disk exactly as it was. Unlinking on one device removes the published record, so other devices unlink it too — again without touching anyone's folder.

### Document search inside folders

Every sync walks project and reference-material folders recursively — those in the sync root and linked ones alike — and extracts the text of the files it can read into a full-text index:

| Format | Read from |
| :--- | :--- |
| `.pdf` | Page content streams, with each font's `/ToUnicode` map applied |
| `.docx` / `.docm` | Document body, headers, footers, footnotes, endnotes, comments |
| `.doc` | Word 97-2004 piece table, including fast-saved documents |
| `.pptx` / `.pptm` | Slides in presentation order, plus speaker notes |
| `.pages` | Pages '09 XML, or the PDF preview saved inside a newer document |
| `.md` / `.markdown` / `.txt` | As written, with byte-order marks and legacy code pages honored |

Searching the Library then matches file contents as well as object names, and a match appears as its own **Document** card that opens the file in whatever application the system uses for it.

Extraction is keyed on file size and modification time, so a file is parsed once per version and later syncs cost one `stat` per file. `.pages` documents saved as package directories are indexed as a single document, and their fingerprint comes from the package contents.

Some files hold pictures rather than text and index as empty with the reason recorded: scanned PDFs, image-only slide decks, and Pages 5+ documents saved without a preview (which store text in an undocumented compressed format — export to PDF or Word, or save with a preview, to make one searchable). `puzzlepkm documents list` shows which files yielded nothing and why.

```bash
npm run cli -- documents search "consolation"   # Search inside the indexed files
npm run cli -- documents status                 # How much is indexed, and which formats are readable
npm run cli -- documents index --force          # Re-read every file, ignoring the size/mtime cache
```

---

## How Your Data Is Stored

Two things hold your knowledge base, and only one of them is the original.

### The sync folder is the source of truth

Everything you write is a plain file in the folder you configured, in a layout you can read without this app:

```text
<sync root>/
├── daily-notes/2026-03-14.md
├── topic-notes/discernment-notes-5548060a.md
├── habits/morning-prayer-e4517203.md  # one file per practice, log in the body
├── projects/<project-slug>/          # your own files, plus meta.yaml
├── ref-materials/<material-slug>/    # your own files, plus meta.yaml
└── mobile-inbox/                     # capture drop-box, consumed on sync
```

Notes and habits are Markdown with YAML front matter. Projects and reference materials are ordinary folders holding whatever you put in them, identified by a small `meta.yaml`:

```yaml
---
id: "5548060a-8376-4d4b-a2a2-064805846114"
type: "topic-note"
title: "Discernment notes for the retreat"
date: ""
tags: ["retreat"]
linkedObjectIds: []
createdAt: "2026-03-14T09:12:04.118Z"
updatedAt: "2026-03-14T09:31:52.740Z"
---

- Consolation without previous cause <!-- blk-2328f132e1ff -->
```

The trailing HTML comment on a line is a **block id**. It is what lets another note link to that exact paragraph and survive edits around it; leave it in place when editing files by hand, and omit it when writing new lines — the app assigns one on the next save.

`linkedObjectIds` is **derived, not authoritative**. PuzzlePKM works out a note's links from its content — `@`-mentions, dates, scripture references — and rewrites the list on every save, so editing it by hand achieves nothing and an entry naming a deleted object is simply ignored. It is written into the file so other tools can read the graph, not so PuzzlePKM can read it back.

Note that the file does **not** record its own location either: sync paths are derived from where a file is actually found, so moving or renaming a folder is something PuzzlePKM follows rather than fights.

### The database is a derived index

The SQLite database is a fast local index over those files, not a second copy of record. It lives outside your sync folder, in the platform application-data directory:

| Platform | Location |
| :--- | :--- |
| macOS | `~/Library/Application Support/puzzlepkm/puzzlepkm.sqlite` |
| Linux | `~/.config/puzzlepkm/` |
| Windows | `%APPDATA%\puzzlepkm\` |

Because the identity of every object lives in its file's front matter, the database is reconstructible. Deleting it and running `npm run cli -- sync` re-imports the folder and restores your objects with their original ids, links intact. That also means the folder — not the database — is what you back up, and any Markdown editor is a valid second way into your notes.

### The installed app

An installed `PuzzlePKM.app` reads the same database as the CLI in this checkout, so both see one knowledge base. The app bundles its own copy of `cli.mjs` and `cli/` as resources and shells out to them for every operation; it does not need a source tree.

It does need Node. A GUI app launched from the Dock does not inherit your shell `PATH`, so PuzzlePKM tries `node`, then the common Homebrew and MacPorts locations. If Node lives somewhere else — under nvm, for instance — set `PUZZLEPKM_NODE_PATH` to an absolute path.

### Environment variables

| Variable | Purpose |
| :--- | :--- |
| `PUZZLEPKM_DB_PATH` | Absolute path to a database file. Useful for a scratch knowledge base while testing. |
| `PUZZLEPKM_SECRETS_PATH` | Override the settings/secrets file location. |
| `PUZZLEPKM_NODE_PATH` | Absolute path to the Node binary the desktop app should use. |
| `PUZZLEPKM_MCP_ALLOW_WRITES` | `true` enables the MCP server's write tools. Anything else keeps it read-only. |

---

## Common CLI Commands

```bash
# General Management
npm run cli -- list topic-note         # List all topic notes
npm run cli -- get topic-note <id>     # Display detailed object JSON
npm run cli -- delete habit <id>       # Destructively delete a habit and its whole log
npm run cli -- tasks list              # Markdown checkboxes gathered from your notes

# Database Migration
npm run cli -- migrate-links --apply   # Migrate legacy links to canonical UUIDs

# Syncing
npm run cli -- sync                    # Trigger a one-shot sync to folders
npm run cli -- sync --watch            # Run background sync watcher daemon

# Document text index
npm run cli -- documents search <query>  # Full-text search inside indexed documents
npm run cli -- documents index           # Re-scan project and ref-material folders now
npm run cli -- documents list            # Indexed documents with extraction status
npm run cli -- documents status          # Index totals and readable formats
```

---

## MCP Server

PuzzlePKM ships an MCP server so an AI assistant can search and reason over your knowledge base. It reads the same local SQLite database and goes through the same repositories as the CLI and desktop app, so backlinks, scripture extraction, and sync paths behave identically no matter which client wrote the data. Nothing leaves your machine.

The database lives in the platform application data directory (`~/Library/Application Support/puzzlepkm/puzzlepkm.sqlite` on macOS), not in this repository, so the MCP server sees the same knowledge base as an installed copy of the desktop app regardless of where its code is loaded from.

**Writes are disabled by default.** Read tools are always available; the write tools refuse until you explicitly enable them.

### Tools

| Tool | What it does |
| :--- | :--- |
| `search_knowledge_base` | Substring search across note titles, individual note blocks, projects, reference materials, habits, scriptures, tags, and indexed document text. |
| `search_documents` | Full-text search inside the documents held in project and reference-material folders. |
| `get_document_text` | Read one indexed document's extracted text in full. |
| `list_documents` | Indexed documents with extraction status, plus index totals. |
| `list_objects` | List every object of one kind, with paging. |
| `get_object` | Fetch one object in full by kind and id. |
| `get_note_context` | A note plus its blocks, tags, outbound links, backlinks, and cited scriptures in one call. |
| `get_daily_note` | Read a day's daily note, defaulting to today. |
| `get_backlinks` | What links to and from an object. |
| `get_graph_neighborhood` | Walk the link graph outward from an object, up to 3 hops. |
| `list_scripture_references` | Extracted scripture references with the notes citing each one. |
| `get_habit_log` | Per-habit consistency: cadence, gap since the last occurrence, gaps between past ones, and due state. |
| `list_tags` | Tags with usage counts broken down by object kind. |
| `find_stale_notes` | Topic notes not updated in a while, for resurfacing. |
| `get_status` | Counts, sync root, and what needs attention (unlinked notes, Inbox backlog, habits due or overdue). |
| `create_topic_note` | Create a topic note from markdown. *Requires writes.* |
| `update_topic_note` | Update a note's title, body, or tags. *Requires writes.* |
| `append_to_daily_note` | Append to a day's daily note, creating it if needed. Never overwrites. *Requires writes.* |
| `set_habit` | Create a habit, rename it, change how its cadence is decided, or retire it. *Requires writes.* |
| `log_habit` | Record that a habit was practised on a date, or remove an occurrence. *Requires writes.* |
| `sync_now` | Reconcile the database with the sync folder. *Requires writes.* |

### Install into Claude Desktop

Build the bundle and open it:

```bash
npm run mcp:build-bundle      # writes release/puzzlepkm.mcpb
open release/puzzlepkm.mcpb   # installs it into Claude Desktop
```

In the extension's settings, set:

- **PuzzlePKM folder or app** — either this checkout (the folder containing `cli.mjs`) or an installed `PuzzlePKM.app`. The Tauri bundle ships `cli.mjs` and `cli/` as app resources, so the launcher resolves the server inside `Contents/Resources` and no source tree is required. An installed app must have been built from a version that includes the MCP server.
- **Node executable** — an absolute path to Node 22+. An absolute path is required because apps launched from the Dock do not inherit your shell `PATH`, so a bare `node` will not resolve under nvm.
- **Allow writing to the knowledge base** — leave off for read-only.

The bundle is a thin launcher that delegates to `cli/mcp/server.mjs` in this checkout, so repository changes take effect on the next restart with no repacking.

### Run it manually

```bash
npm run mcp                                    # read-only, stdio transport
PUZZLEPKM_MCP_ALLOW_WRITES=true npm run mcp    # writes enabled
```

`PUZZLEPKM_MCP_ALLOW_WRITES=true` enables the write tools; anything else keeps the server read-only. The database and secrets paths can be overridden with the same variables the CLI uses — see [Environment variables](#environment-variables).

---

## Development

### Local builds and checks

```bash
npm run build
npm run lint
npm run version:check
```

### Tests

Everything runs on `node --test`; there is no test-runner dependency.

```bash
npm run test:sync-parser      # sync front matter and markdown parsing
npm run test:smoke            # CLI create/read/update/delete and sync
npm run test:mcp              # MCP server protocol and tools
npm run test:linked-sources   # linked directories (DEC-70)
npm run test:documents        # document extraction and the search index (DEC-79)
```

### Build a macOS binary locally

`npm run tauri:build` syncs app version metadata, auto-selects a local Developer ID signing identity (when available), aligns `APPLE_TEAM_ID` with that identity, and runs `tauri build`.

Run a preflight first to print the exact env values expected by your current machine setup:
```bash
npm run macos:preflight
```

To fail fast when required values are missing:
```bash
npm run macos:preflight:strict
```

You can run the security check directly:
```bash
npm run macos:verify
```

For public distribution builds, configure your Apple Developer signing/notarization environment variables first:
```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: <name> (<TEAMID>)"
export APPLE_ID="<apple-id-email>"
export APPLE_PASSWORD="<app-specific-password>"
export APPLE_TEAM_ID="<TEAMID>"
```

`npm run tauri:build:publish` will now prompt for any missing `APPLE_ID`, `APPLE_PASSWORD`, or `GITHUB_TOKEN`. To pre-set values explicitly:
```bash
export GITHUB_TOKEN="<github_token_with_repo_access>"
npm run tauri:build:publish
```

### Versioning

PuzzlePKM uses Changesets for automated version PRs on `main`.

```bash
# Create a changeset in your feature branch
npm run changeset

# Optional local validation before opening a PR
npm run version:check
```

When changesets reach `main`, GitHub Actions opens or updates a `chore: version packages` PR. Merging that PR bumps versions in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` together.

`.gitignore` excludes markdown, so `.changeset/*.md` and `CHANGELOG.md` are explicitly re-included — commit the changeset with your feature branch or the workflow will find nothing to release.

### Project Layout

```text
cli.mjs            CLI entrypoint
cli/commands/      Command routing
cli/objects/       Per-object repositories and services
cli/documents/     Document text extractors (PDF, Word, PowerPoint, Pages, text)
cli/mcp/           MCP server
src/               React desktop UI shell
src-tauri/         Tauri desktop host
mcpb/              Claude Desktop bundle launcher
public/            Static assets
scripts/           Tests and automation helpers
```

---

## License

MIT. See `LICENSE`.
