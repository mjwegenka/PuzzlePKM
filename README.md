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

---

## Installation & Setup

### Requirements

- **Node.js**: Version 22 or higher is required.
- **Operating System**: macOS, Linux, or Windows.

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
| `habit` | Simple checkable habits. | `habit` |
| `project` | Local folder-backed directories for projects. | `project` |
| `ref-material` | Local folder-backed directories for reference materials. | `ref-material` |
| `scripture` | Automatically parsed scripture references. | `scripture` |
| `tag` | Organization labels (case-insensitive). | `tag` |
| `link` | Internal relationships between objects. | `link` |

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
Habits represent simple recurring tasks. They support a status of `planned` or `accomplished` and accept a maximum of one tag.
* **Via CLI (Interactive)**:
  ```bash
  npm run cli -- create habit
  ```
* **Via Desktop UI**: In the **Library** or **Calendar** tab, click **New** and choose **Habit**. Set its name, date, state, and tag in the fields provided.

#### 4. Projects
Projects are folder-backed workspaces designed to hold your local project files (source code, assets, documents) alongside PKM notes.
* **Filesystem-First Creation (Recommended)**: Simply create a subdirectory under `projects/` in your configured sync root (e.g., `projects/my-new-project/`). PuzzlePKM's sync engine will automatically discover the folder, initialize a managed `meta.yaml` metadata file, and integrate it into your Library.
* **Via CLI (Interactive)**:
  ```bash
  npm run cli -- create project
  ```

#### 5. Reference Materials
Reference Materials are folder-backed resource records (books, articles, PDFs) integrated with a database-backed author catalog.
* **Filesystem-First Creation (Recommended)**: Simply create a subdirectory under `ref-materials/` in your configured sync root (e.g., `ref-materials/book-title/`). PuzzlePKM's sync engine will automatically discover the folder, initialize a managed `meta.yaml` metadata file, and integrate it into your Library.
* **Via CLI (Interactive)**:
  ```bash
  npm run cli -- create ref-material
  ```

#### 6. Scriptures
You do not manually create scriptures! PuzzlePKM automatically scans your topic and daily note bodies for RSVCE Bible citations (e.g. `Romans 3:16`, `1 Corinthians 13:4-8`).
* **Creation**: Simply mention a valid scripture reference in a note block. On save, PuzzlePKM converts it into an internal scripture object and maintains backlinks to the source notes automatically.

#### 7. Tags
Tags organize your PKM database.
* **Via CLI**:
  ```bash
  npm run cli -- create tag
  ```
* **Implicit Creation**: Tags are automatically created when you add them to any note or object via front matter or the editor tag field.

#### 8. Links
Links represent relationships between objects.
* **Via CLI**:
  ```bash
  npm run cli -- create link
  ```
* **Implicit Creation**: Simply write internal links in note content using the `@` mention menu in the desktop editor or manual Markdown links `[Label](objectId)`.

---

## Common CLI Commands

```bash
# General Management
npm run cli -- list topic-note         # List all topic notes
npm run cli -- get topic-note <id>     # Display detailed object JSON
npm run cli -- delete habit <id>       # Destructively delete a habit

# Database Migration
npm run cli -- migrate-links --apply   # Migrate legacy links to canonical UUIDs

# Syncing
npm run cli -- sync                    # Trigger a one-shot sync to folders
npm run cli -- sync --watch            # Run background sync watcher daemon
```

---

## MCP Server

PuzzlePKM ships an MCP server so an AI assistant can search and reason over your knowledge base. It reads the same local SQLite database and goes through the same repositories as the CLI and desktop app, so backlinks, scripture extraction, and sync paths behave identically no matter which client wrote the data. Nothing leaves your machine.

The database lives in the platform application data directory (`~/Library/Application Support/puzzlepkm/puzzlepkm.sqlite` on macOS), not in this repository, so the MCP server sees the same knowledge base as an installed copy of the desktop app regardless of where its code is loaded from.

**Writes are disabled by default.** Read tools are always available; the write tools refuse until you explicitly enable them.

### Tools

| Tool | What it does |
| :--- | :--- |
| `search_knowledge_base` | Substring search across note titles, individual note blocks, projects, reference materials, habits, scriptures, and tags. |
| `list_objects` | List every object of one kind, with paging. |
| `get_object` | Fetch one object in full by kind and id. |
| `get_note_context` | A note plus its blocks, tags, outbound links, backlinks, and cited scriptures in one call. |
| `get_daily_note` | Read a day's daily note, defaulting to today. |
| `get_backlinks` | What links to and from an object. |
| `get_graph_neighborhood` | Walk the link graph outward from an object, up to 3 hops. |
| `list_scripture_references` | Extracted scripture references with the notes citing each one. |
| `get_habit_log` | Habit history with completion rates and current streaks. |
| `list_tags` | Tags with usage counts broken down by object kind. |
| `find_stale_notes` | Topic notes not updated in a while, for resurfacing. |
| `get_status` | Counts, sync root, and what needs attention (unlinked notes, Inbox backlog, habits still due). |
| `create_topic_note` | Create a topic note from markdown. *Requires writes.* |
| `update_topic_note` | Update a note's title, body, or tags. *Requires writes.* |
| `append_to_daily_note` | Append to a day's daily note, creating it if needed. Never overwrites. *Requires writes.* |
| `set_habit` | Create a habit or mark an existing one accomplished. *Requires writes.* |
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

| Environment variable | Purpose |
| :--- | :--- |
| `PUZZLEPKM_MCP_ALLOW_WRITES` | `true` to enable the write tools. Anything else keeps the server read-only. |
| `PUZZLEPKM_DB_PATH` | Override the database location. |
| `PUZZLEPKM_SECRETS_PATH` | Override the settings/secrets file location. |

---

## Development

### Local builds and checks

```bash
npm run build
npm run lint
npm run version:check
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

### Project Layout

```text
cli.mjs     CLI entrypoint
cli/        CLI command and object modules
src/        React desktop UI shell
src-tauri/  Tauri desktop host
public/     Static assets
scripts/    Tests and automation helpers
```

---

## License

MIT. See `LICENSE`.
