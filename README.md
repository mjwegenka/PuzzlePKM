# Dropith

A local-first knowledge management app with Dropbox sync. **CLI-first** — all features are available and fully functional from the command line. An Electron desktop UI is also included but is secondary.

## Features

- **Topic Notes** – Rich-text notes with tags and bi-directional links to other objects
- **Daily Notes** – One note per calendar day (date-anchored routing, uniqueness enforced)
- **Projects & Reference Materials** – Dropbox-backed directories browsable inside the app
- **Habits** – Lightweight dated text entries (≤ 255 chars) with tags
- **Tags** – Case-insensitive, aggregate any object type
- **TipTap editor** – Headings, bold/italic/underline/strike, lists, blockquote, code, links, @mention cross-linking with autocomplete
- **Backlinks panel** – See every note that links to the current note
- **Auto-save** – 1-second debounce after every change
- **Keyboard shortcuts** – ⌘K quick search, ⌘N new note, ⌘S save, ⌘E toggle edit, ⌘⇧F full-text search
- **Dropbox OAuth** – CLI-driven browser-based OAuth; token stored locally in secrets file
- **Offline-first** – SQLite local store; sync when connected
- **Background sync daemon** – `dropith sync --watch` for continuous background syncing

## Tech Stack

| Layer | Choice |
|---|---|
| CLI | Pure Node.js (`cli.mjs`) — no build step required |
| Desktop shell | Electron 30 + vite-plugin-electron (legacy/secondary) |
| UI | React 18 + TypeScript |
| Editor | TipTap v3 |
| Local store | node:sqlite (built-in SQLite) |
| State | Zustand |
| Routing | react-router-dom v7 |
| Styling | Material UI + TailwindCSS v4 |
| Secure storage | app-managed secrets file (DEC-23) |
| Dropbox | Dropbox JS SDK (Electron) / fetch (CLI) |

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

### 3. Run in development mode

```bash
npm run dev
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

Default CLI database path follows Electron app-data conventions:
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

### 4. Build for production

```bash
npm run build
```

To also package a distributable macOS `.dmg`:

```bash
npm run build:all
```

## Project Structure

```
cli.mjs            Standalone CLI (no build step — runs directly with Node.js 22+)

electron/          Electron main process (Node.js / Electron)
  auth/            Dropbox OAuth + Electron safeStorage helpers
  db/              SQLite schema and database init
  ipc/             IPC handler registration (notes, objects, auth, sync)
  repositories/    CRUD repositories for every object type

src/               Renderer process (React / TypeScript)
  components/      Shared UI components
    editor/        TipTap NoteEditor + MentionList + BacklinkExtension
  routes/          Page-level route components (TopicNotePage, DailyNotePage)
  shared/          Types and IPC channel constants shared across processes
  store/           Zustand stores (notesStore, uiStore)
  lib/             Utilities (dateUtils, ipc bridge)
```

## Development Plan

See [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) for the full staged roadmap.  
Stages 1–5 are implemented. Stages 6–8 are in active implementation (Dropbox file browsing, Habits/Tags views, and sync controls). Stage 9 remains release-readiness.

