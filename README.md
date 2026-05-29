# PuzzlePKM

<p>
  <img src="./public/icons/icon-128.png" alt="PuzzlePKM icon" width="128" height="128" />
</p>

PuzzlePKM is a local-first personal knowledge management app with a fast CLI and a desktop interface.
Your notes and objects stay in a local SQLite database and sync to a folder you control.

## Download for macOS

- Direct download (always points to the latest published desktop build):
  `https://github.com/mjwegenka/PuzzlePKM/releases/download/desktop-latest/PuzzlePKM-macos.dmg`

## Status

PuzzlePKM is stable and ready for day-to-day local-first PKM workflows.

## Core capabilities

- Capture and organize `daily-note`, `topic-note`, `habit`, `project`, `ref-material`, `scripture`, and `tag` objects.
- Author rich note content with links and automatic backlinks between objects.
- Browse and edit your data from either the CLI or desktop UI.
- Sync to local folders for portability and backup-friendly workflows.

## Stack

- Node.js 22+ CLI (`cli.mjs`)
- React + TypeScript + Vite desktop UI shell (`src/`)
- Tauri desktop wrapper (`src-tauri/`)
- Built-in `node:sqlite` local persistence

## Quick start

### Requirements

- Node.js 22+

### Install

```bash
npm install
```

### CLI help

```bash
npm run cli -- --help
```

### Optional: set a sync root folder

```bash
npm run cli -- settings set root-folder "/PuzzlePKM"
```

### Run the desktop app in development

```bash
npm run tauri:dev
```

### Build a macOS binary and publish the README download link target

`npm run tauri:build` now runs `tauri build` and then uploads the newest DMG to the GitHub release tag `desktop-latest` as `PuzzlePKM-macos.dmg`.

Set a token before running the command:

```bash
export GITHUB_TOKEN="<github_token_with_repo_access>"
npm run tauri:build
```

If `GITHUB_TOKEN` is not set, the build still runs locally and upload is skipped.

## Common CLI commands

```bash
npm run cli -- add "Quick note text"
npm run cli -- list daily-note
npm run cli -- get topic-note <id>
npm run cli -- create project
npm run cli -- update habit <id>
npm run cli -- delete tag <id>
```

### Sync

```bash
npm run cli -- sync
npm run cli -- sync --watch
npm run cli -- sync --watch --interval 5
```

## Build and checks

```bash
npm run build
npm run lint
npm run version:check
```

## Versioning

PuzzlePKM uses Changesets for automated version PRs on `main`.

```bash
# Create a changeset in your feature branch
npm run changeset

# Optional local validation before opening a PR
npm run version:check
```

When changesets reach `main`, GitHub Actions opens or updates a `chore: version packages` PR. Merging that PR bumps versions in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` together.

## Project layout

```text
cli.mjs     CLI entrypoint
cli/        CLI command and object modules
src/        React desktop UI shell
src-tauri/  Tauri desktop host
public/     Static assets
scripts/    Tests and automation helpers
```
