# AGENTS.md

## Repo State
- This repository is CLI-first with a Tauri desktop wrapper.
- Core product logic lives in `cli.mjs`; desktop UI shell code lives in `src/` and `src-tauri/`.
- Vite config is in `vite.config.ts`; desktop wrapper config is in `src-tauri/tauri.conf.json`.

## Canonical Ownership (avoid drift)
- `README.md`: product/domain truth (what the app is, object definitions).
- `IMPLEMENTATION_DECISIONS.md`: implementation decision log (behavior decisions; `DEC-*` IDs).
- `DEVELOPMENT_PLAN.md`: stage sequencing and delivery boundaries (when work lands).
- `AGENTS.md` (this file): workflow rules for coding agents.

If information must change, update the canonical file above instead of duplicating the same rule in multiple docs.

## Read Order for Any Task
1. `README.md`
2. `IMPLEMENTATION_DECISIONS.md`
3. `DEVELOPMENT_PLAN.md`

## Documentation Hygiene Rules
- Do not duplicate behavioral rules across docs; link to the canonical file.
- If a statement conflicts across files, reconcile by updating the canonical owner and removing stale copies.
- When implementation changes affect prior decisions, append a new `DEC-*` entry (do not silently rewrite history).
- Keep command lists synchronized between `AGENTS.md` and `README.md`.

## Implementation Guardrails
- Platform target is macOS-first Node.js CLI.
- Build local-first CRUD/repository behavior before full sync complexity.
- Preserve ID-based linking and Daily Note uniqueness by local date.
- Local persistence uses built-in `node:sqlite`; avoid reintroducing native DB addons unless necessary.
- Secret storage uses the app-managed local secrets file; avoid native secret-storage addons unless there is a clear product need.

## How to Record New Decisions
- Add a new `DEC-*` entry in `IMPLEMENTATION_DECISIONS.md`.
- Reference both old and new IDs only if superseding an older decision.
- In code/PRs, cite the relevant `DEC-*` IDs to keep behavior traceable.

## Delivery Strategy
- Follow stages in `DEVELOPMENT_PLAN.md`; do not jump to later-stage features unless requested.
- Prefer small vertical slices: schema -> repository -> UI/editor -> sync wiring.
- Ship minimal runnable slices first, then broaden feature depth.

## Commands and Validation
- Install dependencies: `npm install`
- Run CLI: `npm run cli -- --help`
- Run companion web shell: `npm run dev`
- Run desktop wrapper in development: `npm run tauri:dev`
- Typecheck + bundle: `npm run build`
- Build desktop wrapper: `npm run tauri:build`
- Lint: `npm run lint`
- Run full build alias: `npm run build:all`
- Run SQLite benchmark harness: `npm run benchmark:sqlite`
- Preview next issue queue labels (dry run): `npm run issues:queue`
- Apply issue queue labels locally: `npm run issues:queue:apply`
- If tooling changes, keep these commands updated here and in `README.md`.
