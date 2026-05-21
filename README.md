# Dropith

A local-first knowledge management app with Dropbox sync. The core product surface is the CLI in `cli.mjs`, with a desktop wrapper powered by Tauri.

## Features

- **Topic Notes** – Rich-text notes with tags and bi-directional links to other objects
- **Daily Notes** – One note per calendar day (date-anchored routing, uniqueness enforced)
- **Projects & Reference Materials** – Dropbox-backed directories browsable inside the app. Each directory is named by slug derived from the project/reference material title and contains a `meta.yaml` file with metadata. Directories can contain user files alongside the metadata.
- **Habits** – Lightweight dated text entries (≤ 255 chars) with tags
- **Tags** – Case-insensitive, aggregate any object type
- **Dropbox OAuth** – CLI-driven browser-based OAuth; token stored locally in secrets file
- **Offline-first** – SQLite local store; sync when connected
- **Background sync daemon** – `dropith sync --watch` for continuous background syncing

## Tech Stack

| Layer | Choice |
|---|---|
| CLI | Pure Node.js (`cli.mjs`) — no build step required |
| Desktop wrapper | Tauri v2 (Rust host + web UI shell) |
| Companion web shell | React 18 + TypeScript + Vite |
| Desktop UI | Material-UI v5 + custom components |
| Local store | node:sqlite (built-in SQLite) |
| Styling | Material UI + TailwindCSS v4 |
| Secure storage | app-managed secrets file (see `DEC-31`) |
| Dropbox | `fetch`-based Dropbox API integration |

## Desktop UI Features

The desktop wrapper provides a full-featured interface for knowledge management:

- **Calendar View** – Navigate daily notes by date
- **File Browser** – Browse and manage projects and reference materials
- **Object Editor** – Create and edit notes with rich text support
- **@ Mentions** – Link to other objects by typing `@` in note content; supports block-level link targets using `dropboxPath#blockId` format (see [`DEC-28`](./IMPLEMENTATION_DECISIONS.md) for the full block identity and lifecycle contract)
- **Tag Management** – Organize content with tags (bottom of editor)
- **Sidebar Navigation** – Quick access to all views

See [DESKTOP_UI_GUIDE.md](./DESKTOP_UI_GUIDE.md) for detailed UI architecture and layout specifications.

## Development Setup

### Prerequisites
- Node.js 22+ (uses built-in `node:sqlite`)
- macOS, Linux, or Windows
- A Dropbox developer account for OAuth credentials

### 1. Install dependencies

```bash
npm install
```

### 2. Configure Dropbox credentials

Save your Dropbox App credentials using the CLI:

```bash
dropith settings set dropbox <app-key> <app-secret>
```

Or pass them as environment variables:

```bash
export DROPBOX_APP_KEY=your_app_key
export DROPBOX_APP_SECRET=your_app_secret
```

Create your Dropbox app at <https://www.dropbox.com/developers/apps> and set the Redirect URI to `http://localhost:42813/callback`.

### 3. Run the companion web shell in development

```bash
npm run dev
```

### 4. Run the desktop wrapper in development

```bash
npm run tauri:dev
```

### CLI usage

Run the CLI directly:

```bash
npm run cli -- --help
```

Run the interactive shell:

```bash
npm run cli
```

The shell exits with `Ctrl+C` or `Ctrl+D`.

#### Dropbox authentication

```bash
# Connect to Dropbox (opens browser for OAuth)
dropith auth connect

# Show connection status
dropith auth status

# Disconnect (clear token)
dropith auth disconnect
```

#### Sync

```bash
# One-shot sync with Dropbox
dropith sync

# Background sync daemon (syncs every 15 minutes by default)
dropith sync --watch

# Background sync with custom interval
dropith sync --watch --interval 5
```

`dropith sync` syncs daily notes, topic notes, habits, projects, and reference materials. If sync folders are missing in Dropbox, Dropith creates them automatically. Projects and reference materials are stored as directories:

- **Daily notes**: `{rootFolder}/daily-notes/{date}.md`
- **Topic notes**: `{rootFolder}/topic-notes/{slug}-{shortId}.md`
- **Habits**: `{rootFolder}/habits/{id}.md`
- **Projects**: `{rootFolder}/projects/{slug}/meta.yaml` (directory can contain user files)
- **Reference Materials**: `{rootFolder}/ref-materials/{slug}/meta.yaml` (directory can contain user files)

When a project or reference material name changes, its directory is renamed to match the new slug. Dropbox directory names are automatically determined by the project/reference material title.

If a note has previously been synced to Dropbox and then its Markdown file is deleted from an existing Dropbox notes folder, the next sync deletes the local copy instead of recreating it. If an entire Dropbox notes folder is missing, Dropith recreates that folder, leaves local data unchanged for that run, and reports a warning to avoid accidental mass deletion.

#### Notes and objects

```bash
dropith add "Quick note text"
dropith list daily-note
dropith get topic-note <id>
dropith create project
dropith update habit <id>
dropith delete tag <id>
dropith browse all

# Batch import Markdown notes from a directory
dropith import daily-note ./daily-notes
dropith import topic-note ./topic-notes
```

#### Settings

```bash
dropith settings show
dropith settings set dropbox <app-key> <app-secret>
dropith settings set root-folder /Dropith
dropith settings clear dropbox
dropith settings disconnect dropbox
```

Default CLI database path follows platform app-data conventions:
- macOS: `~/Library/Application Support/dropith/dropith.sqlite`
- Linux: `~/.config/dropith/dropith.sqlite` (or `$XDG_CONFIG_HOME/dropith/dropith.sqlite`)
- Windows: `%APPDATA%\\dropith\\dropith.sqlite`

Install globally from a checkout (optional) to use the `dropith` command:

```bash
npm install -g .
dropith --help
```

Use `DROPITH_DB_PATH` to point the CLI at a specific Dropith SQLite file:

```bash
DROPITH_DB_PATH=/absolute/path/to/dropith.sqlite dropith list
```

### 5. Build for production

```bash
npm run build
```

Build desktop packages:

```bash
npm run tauri:build
```

To run the full build alias used by repo automation:

```bash
npm run build:all
```

## Project Structure

```
cli.mjs            Standalone CLI (no build step — runs directly with Node.js 22+)
src/               Lightweight companion web shell (React / TypeScript)
src-tauri/         Desktop wrapper host (Tauri config + Rust commands)
public/            Static assets for the web shell
```

## Development Plan

See [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) for the full staged roadmap.

