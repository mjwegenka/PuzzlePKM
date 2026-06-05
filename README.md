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
Projects are local-folder-backed directories containing user files and a managed `meta.yaml` file.
* **Via CLI (Interactive)**:
  ```bash
  npm run cli -- create project
  ```
* **Via Desktop UI**: In the sidebar or library view, choose **New Project**, specify its name, optional start/end dates, and tags.

#### 5. Reference Materials
Reference Materials represent books, articles, or resources. They support a single author selection from a database-backed catalog.
* **Via CLI (Interactive)**:
  ```bash
  npm run cli -- create ref-material
  ```
* **Via Desktop UI**: Select **New Reference Material**, enter the title, select or type a new author, and add tags.

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
