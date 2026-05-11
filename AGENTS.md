# AGENTS.md

## Repo State
- This repository has a runnable Electron + React + TypeScript application baseline.
- Main-process code lives in `electron/`; renderer code lives in `src/`.
- Packaging config is in `electron-builder.json5`; Vite config is in `vite.config.ts`.

## Canonical Ownership (avoid drift)
- `README.md`: product/domain truth (what the app is, object definitions).
- `IMPLEMENTATION_QUESTIONS.md`: implementation decision log (how behavior is decided; `DEC-*` IDs).
- `DEVELOPMENT_PLAN.md`: stage sequencing and delivery boundaries (when work lands).
- `AGENTS.md` (this file): workflow rules for coding agents.

If information must change, update the canonical file above instead of duplicating the same rule in multiple docs.

## Read Order for Any Task
1. `README.md`
2. `IMPLEMENTATION_QUESTIONS.md`
3. `DEVELOPMENT_PLAN.md`

## Documentation Hygiene Rules
- Do not duplicate behavioral rules across docs; link to the canonical file.
- If a statement conflicts across files, reconcile by updating the canonical owner and removing stale copies.
- When implementation changes affect prior decisions, append a new `DEC-*` entry (do not silently rewrite history).
- Keep command lists synchronized between `AGENTS.md` and `README.md`.

## Implementation Guardrails
- Platform target is macOS-first Electron.
- Keep Electron main and renderer responsibilities separated early via explicit IPC boundaries.
- Build local-first CRUD/repository behavior before full sync complexity.
- Preserve ID-based linking and Daily Note uniqueness by local date.
- Local persistence uses built-in `node:sqlite`; avoid reintroducing native DB addons unless necessary.
- Secret storage uses Electron `safeStorage`; avoid native keychain addons unless there is a clear product need.

## How to Record New Decisions
- Add a new `DEC-*` entry in `IMPLEMENTATION_QUESTIONS.md`; do not silently rewrite prior decisions.
- If superseding an older decision, reference both IDs (`supersedes DEC-xx`).
- In code/PRs, cite the relevant `DEC-*` IDs to keep behavior traceable.

## Delivery Strategy
- Follow stages in `DEVELOPMENT_PLAN.md`; do not jump to later-stage features unless requested.
- Prefer small vertical slices: schema -> repository -> UI/editor -> sync wiring.
- Ship minimal runnable slices first, then broaden feature depth.

## Commands and Validation
- Install dependencies: `npm install`
- Run CLI: `npm run cli -- --help`
- Run renderer/main dev flow: `npm run dev`
- Typecheck + bundle: `npm run build`
- Lint: `npm run lint`
- Package desktop app: `npm run build:all`
- If tooling changes, keep these commands updated here and in `README.md`.
