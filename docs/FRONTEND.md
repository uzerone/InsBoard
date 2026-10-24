# Frontend Implementation Guide

Use this document for work in `apps/web`, especially React, Vite, custom canvas shapes, CSS, English UI copy, and browser verification.

Start with [Architecture and change map](ARCHITECTURE.md) for feature ownership and task routing.

## Architecture

- `apps/web` is a Vite React app.
- `packages/shared` owns shared contracts, constants, validation helpers, image presets, provider types, workflow execution events, and plan schema types.
- `apps/api` is the source of API behavior. Do not duplicate server rules in the web app when a shared contract or endpoint response already exists.
- The Vite dev server runs on `http://localhost:5173` and proxies `/api` to `http://127.0.0.1:8787`.

## React Rules

- Keep components close to their feature area: `features/canvas`, `features/generation`, `features/project`, `features/workbench`, `features/workflow`, and `features/provider-config`.
- Prefer shared types from `@insboard/shared` over local redefinitions.
- Avoid module-level mutable UI state unless it is an intentional cache and safe across the app lifetime.
- Use lazy initialization for expensive state, `useMemo` for expensive derived values, and `useCallback` where stable references matter for child components or effects.
- Split effects by responsibility. Put user-triggered logic in event handlers rather than effects when possible.
- Use primitive effect dependencies where practical. Avoid object literals, arrays, or inline functions that cause repeated effects.
- Use `startTransition` or deferred state for non-urgent updates that could make typing, canvas interaction, or scrolling feel sticky.

## Performance Rules

- Avoid async waterfalls. Start independent requests together and resolve them with `Promise.all` when the results do not depend on each other.
- Cache repeated metadata reads carefully. Existing caches for asset metadata and previews should stay bounded by actual UI needs.
- Keep canvas work responsive. Avoid heavy synchronous loops in render paths, custom shape rendering, pointer handlers, and WebSocket event handlers.
- Prefer direct imports over broad barrel imports for heavy libraries.
- Load heavy optional UI only when it is needed. Existing lazy/Suspense patterns are the right direction for non-critical panels.

## CSS And Layout

- Use the existing CSS files under `apps/web/src/styles` and the tokens in `tokens.css`.
- Add new CSS in the smallest relevant stylesheet. Do not bury feature-specific styles in global files unless the style is truly shared.
- Use stable dimensions for buttons, toolbars, counters, thumbnails, plan cards, and canvas overlay controls so state changes do not resize the layout.
- Prefer grid and flex wrappers with `gap` over one-off margins on children.
- Keep responsive behavior content-driven. Mobile drawers, side panels, and dialogs must fit without horizontal scrolling.
- Use `docs/design-docs/interaction-quality.md` for UI polish rules: explicit transition properties, `scale(0.96)` press feedback where useful, tabular numbers for dynamic metadata, neutral image outlines, and minimum `40px` hit areas for compact controls.
- Do not add `motion` or `framer-motion` only for micro-interactions. This repo currently uses CSS transitions for polish.

## Language

- The app UI is English only. Add user-visible strings to `apps/web/src/shared/i18n/en.ts`; user-authored prompts and imported content retain their original language.
- Do not hard-code visible strings in components unless the string is a brand, file extension, model ID, or API value.
- Keep API error codes stable and map them to localized messages at the UI boundary.

## Infinite Canvas

- Custom shape utilities must keep props serializable and compatible with saved project snapshots.
- Workflow nodes and placeholder nodes should remain inspectable on the canvas, not hidden scratch state.
- When adding canvas assets, keep asset IDs, metadata URLs, preview URLs, and download URLs consistent with API routes.
- Do not break snapshot restore. Test save and reload behavior when changing shape props or project state.

## Browser Verification

For UI stories:

1. Run `pnpm dev`.
2. Open `http://localhost:5173`.
3. Verify the changed workflow in a browser.
4. Check one desktop viewport and one mobile viewport.
5. For canvas work, confirm selected references, generated placeholders, workflow nodes, and asset previews render correctly.

Run `pnpm check` before completing a code story. Selection/document notification regression tests live in `tests/canvas-editor.test.ts`; `Editor.store.listen` observes document changes only.
