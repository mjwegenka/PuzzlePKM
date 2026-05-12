# Dropith Desktop Wrapper (Tauri)

This folder contains the desktop host for Dropith.

## Architecture

- Frontend UI: `src/` (React + Vite)
- Desktop host: `src-tauri/src/main.rs`
- Command bridge: Tauri command `run_dropith_cli`
- Product logic: delegated to `cli.mjs`

The desktop shell executes `node cli.mjs <args...>` and returns `stdout`, `stderr`, and exit code to the UI.

## Development

```bash
npm run tauri:dev
```

## Build

```bash
npm run tauri:build
```

## Notes

- The desktop shell currently supports non-interactive CLI commands (for example `help`, `list`, `sync`, `auth status`, `settings show`).
- Interactive shell mode (`dropith` with no args or `dropith shell`) is not embedded in the current command panel.
- `cli.mjs` is bundled as a Tauri resource.

