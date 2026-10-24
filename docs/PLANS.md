# Planning Guide

Use this when writing product specs, execution plans, multi-story implementation plans for this repository.

## Where Plans Live

- Product specs live in `docs/product-specs/`.
- Active execution plans live in `docs/exec-plans/active/`.
- After completion, merge durable decisions into the owning guide and remove the execution plan. Git retains the history.
- Create planning files only for active work; do not add empty directories, index files, or placeholder debt trackers.

## Planning Standard

A useful plan should be decision complete enough for another engineer or agent to implement without inventing product behavior. Include:

- Goal and user value.
- In-scope and out-of-scope behavior.
- Affected apps or packages: `apps/api`, `apps/web`, `packages/shared`.
- Public interfaces: API routes, shared types, DB schema, WebSocket events, or UI-visible behavior.
- Error and empty states.
- Security and privacy considerations.
- Verification commands and browser checks.

Keep implementation detail proportional to risk. Small docs or copy changes need a compact plan. Cross-cutting changes touching shared contracts, SQLite, workflow execution, or provider selection need more detail.

## Story Acceptance Criteria

Each story should have acceptance criteria covering:

- Functional behavior.
- Negative cases and failure handling.
- Data persistence or migration impact, if any.
- UI behavior on desktop and mobile when `apps/web` changes.
- Security and privacy when secrets, local data, OAuth tokens, generated images, or provider configs are involved.
- Verification: `pnpm typecheck`, `pnpm build`, and browser verification for UI stories.

## Plan Review Checklist

- Does the plan name the exact workflows it changes?
- Does it avoid duplicating source-of-truth docs or code comments?
- Does it state whether `packages/shared` contracts change?
- Does it state whether SQLite schema or runtime data changes?
- Does it state whether browser verification is required?
- Does it preserve secret handling rules from `docs/SECURITY.md`?
