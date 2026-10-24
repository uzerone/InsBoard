# Security And Privacy Guide

Use this before changing credential handling, provider config, OAuth, generated assets, logs, or local runtime data.

## Security Model

`InsBoard` is designed for local workstation use. It stores project state, generated assets, generation history, provider settings in local runtime data.

Do not treat the app as safe for public internet exposure without adding explicit authentication and network controls.

## Secrets

Secrets may come from:

- `.env` or runtime environment variables.
- Local provider config stored in SQLite.
- Legacy databases may retain unused Agent configuration and conversations; runtime code no longer reads or creates these tables.
- Legacy databases may retain unused OAuth rows; runtime generation never reads them.

Rules:

- Never commit `.env`, `data/`, SQLite databases, generated images, `.codex-temp/`, or build output.
- Never log raw API keys, OAuth tokens, or saved provider values.
- Read APIs should return masked secrets only.
- Preserve existing secret values only when the request explicitly uses a preserve flag or leaves a masked value unchanged.
- If a real key was committed, rotate it. `.gitignore` does not remove secrets from Git history.

## Local Data

Generated images can contain private user content. Treat local assets and previews as sensitive by default.

When adding browser tests that save fake credentials, clear or restore local test configuration before finishing. Do not leave real-looking secrets in `data/`.

## API And Error Handling

- Validate JSON bodies and content types before using request data.
- Prefer stable error codes from shared contracts or API helpers.
- Do not pass raw upstream provider errors directly to clients if they may contain credentials or request internals.
- Do not expose filesystem paths, shell details, environment contents, or database internals through API responses.

## Review Checklist

- Are all user inputs validated before storage or provider calls?
- Are secrets masked in API responses and UI?
- Are logs free of keys, tokens, request headers, and credential-bearing URLs?
- Are generated files written only under `DATA_DIR`?
- Are asset reads constrained to the expected asset directory?
- Does the change avoid exposing the local app publicly by default?
