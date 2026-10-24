# Architecture and change map

Start here when locating a change. InsBoard is a pnpm workspace with one local API, one web interface, a macOS shell, and a shared contract package. Run `pnpm check` for architecture boundaries, typechecking, tests and builds. This guide maps changes to their source files.

## Ownership

| Area | Owner | Responsibility |
| --- | --- | --- |
| App composition | `apps/web/src/features/canvas/CanvasApp.tsx` | Connect feature hooks, selection, and visible panels. |
| Canvas model | `apps/web/src/features/canvas/editor/` | Serializable shapes/assets, document events, camera and geometry. `react.tsx` is the React adapter. |
| Canvas interaction | `features/canvas/InfiniteCanvas.tsx`, `CanvasImageOverlays.tsx` | Pointer/keyboard input, image actions and rendering. |
| Generation | `features/generation/` | Form state, request lifecycle, recovery, placeholders, polling and output options. |
| Project | `features/project/` | Load/autosave, snapshot compatibility, portable project controls and save status. Failed loads block editing and saving until reload succeeds. |
| Workbench | `features/workbench/` | Navigation, narrow-screen drawer and focus behavior. |
| Workflows | `features/workflow/` | Node graph model, inspector, rendering and WebSocket client. |
| Provider settings | `features/provider-config/` | Provider status, configuration form and save lifecycle. |
| Shared web behavior | `apps/web/src/shared/` | API error presentation, validation and localization; no feature imports. |
| HTTP and WebSocket boundaries | `apps/api/src/server/` | Route registration, request validation and transport errors. |
| API behavior | `apps/api/src/domain/` | Generation, workflows, project archives/snapshots, providers and assets. |
| API infrastructure | `apps/api/src/infrastructure/` | Runtime paths, database/schema, provider HTTP client. |
| Contracts | `packages/shared/src/` | Request/response types, execution protocol, limits and shared validation. |
| Desktop | `apps/desktop/src/main.ts` | Window/menu lifecycle, local API startup and application data directory. |
| Tooling | `scripts/`, `apps/desktop/scripts/` | Verification runner, architecture checks, icon and packaging hooks. |

Paths beginning with `features/` above are relative to `apps/web/src/`.

## Dependency direction

- Web, API and desktop consume `packages/shared`; shared contracts do not import applications, React, Electron or Node APIs.
- Web code does not import the API implementation. Cross-process communication uses HTTP/WebSocket contracts.
- API routes depend on domain behavior; domain behavior depends on infrastructure. Infrastructure never imports domain or route modules.
- The editor model does not depend on React components. Its workflow-specific shape normalization and deletion rules call the pure workflow model; that model references `Editor` through a type-only import.
- Runtime cycles and unresolved local imports fail `pnpm check:architecture`. Type-only imports are excluded from the runtime graph.
- Prefer direct imports from the module that owns a function. Existing domain entry files retain a few public re-exports for route callers; do not create a second implementation behind a convenience barrel.

## Common changes

| Change | Start here | Verify |
| --- | --- | --- |
| Creation controls or dimensions | `generation/useGenerationForm.ts`, `generation/options.ts` | Unit checks, desktop/mobile form. |
| Submit, cancel or recover generation | `generation/useGenerationTasks.ts`, API `generation/image-generation.ts` | API smoke suite and reload/cancel UI. |
| Retry/provider failures | API `generation/provider-call.ts`, `infrastructure/providers/image-provider.ts` | Fake provider negative cases; never use a real key in tests. |
| Provider configuration | `provider-config/ProviderConfigDialog.tsx`, API `server/validation/provider-config.ts`, `domain/providers/` | Key preservation, error state, successful close and focus return. |
| Node dependencies or execution | Web `workflow/model.ts`, API `domain/workflow/executor.ts`, `validation.ts`, `references.ts` | `tests/workflow.test.ts`, workflow executor smoke. |
| Selection or document notifications | `canvas/editor/Editor.ts` | `tests/canvas-editor.test.ts`, `tests/canvas-history.test.ts`, visible node selection and deselection. |
| Autosave or restore | `project/useProject.ts`, `project/snapshot.ts`, API `domain/project/` | Snapshot tests, archive smoke, reload. |
| Image files or prompt provenance | API `domain/assets/asset-store.ts`, `generation/generation-records.ts` | History/asset retention and archive smoke. |
| API payload validation | `apps/api/src/server/validation/` | Rejected malformed requests, stable error codes. |
| UI text | `shared/i18n/en.ts` | Typecheck enforces message keys and parameters. English is the UI locale. |
| Native packaging | `apps/desktop/scripts/rebuild-packaged-native.mjs` | Package, signature, installed launch and Node SQLite after packaging. |

## State and compatibility

`Editor.subscribe` notifies selection and document observers. `Editor.store.listen` notifies document persistence only. Camera updates use their own subscription. Document-only `useValue` subscriptions keep workflow state independent of camera frames. `Editor.run` batches document notifications; `editor/history.ts` records at most 100 undo steps and groups a drag or typing session. Runtime generation/reveal changes use `{ history: "ignore" }`; undo applies only edited fields, retaining unrelated background results and uploaded assets. History is disabled while workflow runs are active. A selection change must update the inspector without triggering autosave; a document change must trigger both.

`useProject` owns project readiness, generation records and autosave. `useGenerationTasks` owns in-flight jobs and recovery. The composition root passes the same records and save operation to both. Avoid a second source of truth in panels.

SQLite and generated image files remain private runtime data. Asset-owned prompt metadata must survive deletion of generation records. History browsing and Agent features are retired, but generation records still support recovery and `.idb` archives. Legacy Agent shape filtering is a compatibility step, not a product feature.

Changing paths must not change `/api` routes, `/api/workflow/ws`, execution events, SQLite schema, saved shape props, `.idb` version or provider key semantics. Changes to those contracts need explicit migration and regression coverage.

## Styles

`apps/web/src/styles.css` imports eight owners in order:

1. `tokens.css`: colors, spacing and shared variables.
2. `base.css`: common controls and global defaults.
3. `layout.css`: app frame, navigation and project file controls.
4. `canvas.css`: canvas surface, image overlays and interaction controls.
5. `generation.css`: generation placeholders.
6. `workflow.css`: workflow nodes, links and ports.
7. `workbench.css`: creation form, inspector and narrow-screen drawer.
8. `settings.css`: provider dialog.

Keep responsive rules with the feature they modify. Add new declarations to their owner rather than adding a later override stylesheet. Verify computed layout at desktop and mobile widths when moving rules.

## Checks and runtime isolation

`pnpm check` runs architecture checks, typechecking (including tests), all tests and the production build. Use `pnpm test:unit` or `pnpm test:api` for focused iteration. `scripts/test.mjs` discovers test files and runs each API smoke in a separate Node process with a blank provider key. API smokes use scratch databases, archives and fake image providers under `.codex-temp/`; they do not modify the user's workspace.

- `tests/`: pure editor, workflow and snapshot regression tests.
- `apps/api/tests/`: provider/config, generation-record/asset, archive and executor integration smokes.
- UI checks remain browser-based; see `FRONTEND.md` and use independent verification for release changes.
- `pnpm desktop:package` compiles SQLite in a disposable source copy, copies its binary into the extracted package, preserves unpacked native libraries, updates the ASAR integrity hash and lets electron-builder sign the result. It does not rebuild workspace `node_modules` for Electron.
- `pnpm desktop:verify` checks the signature, ASAR hash, build-file parity, packaged Electron SQLite/sharp and development Node SQLite. Packaging runs this automatically; it uses only in-memory synthetic data.
- `pnpm desktop:dev` packages and opens that isolated bundle. Use `pnpm dev` for fast web/API iteration.
- Changing the development Node version can still require rebuilding Node's SQLite dependency. Packaging should never require that repair.

Build output belongs in `dist/` or `release/`; scratch work belongs in `.codex-temp/`. None belongs in source control.

Workflow node width and height represent proportional visual scale (0.4–4 times the base 300×420 card). Node contents render with local CSS zoom and wire endpoints follow the scaled geometry. Camera navigation stays outside document undo. The grid is a viewport-sized repeating background; never restore the oversized transformed grid layer.

Fit project uses `Shift+1`. Grid snapping uses world-space 24 px coordinates, with `Shift+G` to toggle and Option/Alt to bypass while dragging or resizing. Groups keep their internal offsets. The optional `snapToGrid` snapshot preference defaults to false in legacy projects; it is separate from document undo.

New canvas objects use `canvas/editor/placement.ts` for collision-free placement. `generation/layout.ts` chooses batch geometry around live references and available viewport space; completion rechecks real image dimensions. `tests/canvas-placement.test.ts` protects these rules. Product constraints and their reasoning live in `docs/design-docs/canvas-interactions.md`.

The runtime database is `insboard.sqlite`. On the first start after upgrading, `infrastructure/database-migration.ts` copies the legacy SQLite database through SQLite's backup API, including committed WAL data. The original remains available, and an existing InsBoard database is never replaced.
