# Reliability Guide

Use this before changing API routes, provider selection, workflow execution, asset storage, SQLite behavior, or operational verification.

## Runtime Shape

- `apps/api`: Hono API, WebSocket upgrade handling, SQLite persistence, provider selection, image generation, workflow execution, asset storage.
- `apps/web`: Vite React and the in-house infinite canvas client, served by Vite in development and by the built API app in production.
- `packages/shared`: shared contracts, image presets, validation helpers, provider types, and workflow execution event types.

## Persistence

`DATA_DIR` defaults to `./data` for local web/API use. The desktop app keeps its workspace in macOS Application Support. It contains SQLite state and generated assets. Treat it as private runtime data.

SQLite tables and migrations are defined in `apps/api/src/infrastructure/schema.ts`. Treat this source as authoritative; avoid maintaining a duplicate schema document.

Important persistence rules:

- Never write generated assets outside the configured data/assets path.
- Validate asset paths before reading from disk.
- Keep generation records, outputs, reference assets, and asset rows consistent.
- If changing snapshot format, preserve old project restore behavior or document migration behavior.
- The API runs `PRAGMA quick_check` at startup and should fail fast if SQLite reports corruption. Do not bypass this and keep using the same database; stop the app and restore from backup first.
- Project snapshots are backed up outside SQLite under `data/project-snapshot-backups/` as rotated `.json.gz` files. Treat them as private runtime data and use the newest valid snapshot if the `projects` row becomes unreadable. The backup directory is bounded by count, compressed byte size, and a minimum write interval; tune `PROJECT_SNAPSHOT_BACKUP_MAX_COUNT`, `PROJECT_SNAPSHOT_BACKUP_MAX_BYTES`, `PROJECT_SNAPSHOT_BACKUP_MIN_COUNT`, and `PROJECT_SNAPSHOT_BACKUP_MIN_INTERVAL_MS` only when local recovery needs justify the disk cost.
- Project saves should not replace a large, non-empty saved canvas with an empty snapshot. A rejected empty overwrite usually means the client loaded a fallback/failed project state and should be reloaded after the database issue is fixed.

## Provider Reliability

Provider source order is:

1. Environment OpenAI-compatible config.
2. Local OpenAI-compatible config stored in SQLite.
Image generation and workflow execution require Image API credentials; OAuth login is not supported.

Provider errors should become stable API errors where possible. Avoid exposing raw secrets, raw token values, or noisy upstream internals in responses or logs.

## Image Generation

- Text-to-image and reference-image generation both persist generation records.
- Reference image inputs are size and MIME checked.
- Batch generation uses bounded concurrency.
- Individual output failures should be represented in output status instead of erasing the whole record when partial results exist.
- Generated images must remain locally available.

## Workflow Execution

Workflows are dependency-aware DAGs. Reliability-sensitive rules:

- Plans must be validated before execution.
- Dependency source jobs used downstream must have count `1`.
- Failed jobs can be retried without rerunning successful upstream jobs.
- Cancellation should stop in-flight work where possible and leave the plan in an inspectable state.
- WebSocket events should be stable, typed through `packages/shared`, and safe for reconnect behavior.

## Desktop Packaging

`pnpm desktop:package` uses `apps/desktop/scripts/rebuild-packaged-native.mjs` to compile SQLite in a disposable source copy and transfer its binary to the package before signing. The hook updates the ASAR header hash after repacking. Packaging automatically runs `pnpm desktop:verify` to check signature, build parity, ASAR integrity and actual Electron/Node native-library loading. Also inspect the installed app UI. See `docs/ARCHITECTURE.md` for the runtime and test ownership map.

## Build Checks

For normal stories, run:

```sh
pnpm check
```

For browser verification, run:

```sh
pnpm dev
```

Then open `http://localhost:5173`.
