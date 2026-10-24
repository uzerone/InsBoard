# Provider Configuration

## Goal

Let users choose reliable image generation providers while keeping credentials local, masked, and understandable.

## Image Provider Sources

The image provider source order is:

1. Environment OpenAI-compatible config.
2. Local OpenAI-compatible config stored in SQLite.

Environment configuration comes from `.env` or runtime variables and is read-only in the UI. Local OpenAI-compatible config is editable in the app.

## Settings

Show a single Image API form. Agent configuration, planning, and skills are retired. Load and save request only image provider endpoints.

Use a compact row form with an explicit default address. Model selection belongs to generation controls, not Settings. Saved keys show a saved state; Replace reveals a blank password input, and Cancel replacement restores the saved-key state. The form contains only the API key and address. Preserve existing source priority, provider default model and timeout when saving; do not expose an advanced section. A native modal dialog keeps keyboard focus inside Settings and returns it on close. Enter or Command/Control-S saves. Saving disables fields and dismissal until the request finishes.

The generation panel and workflow node inspector offer Image 2 (`gpt-image-2`), 2.5 Flare (`gpt-image-2.5-flare`), 2.5 Sunburst (`gpt-image-2.5-sunburst`) and Custom. Custom reveals a model-ID field and requires an ID without whitespace, up to 200 characters. Send the chosen model with each text, reference, or workflow request; it overrides the provider default without changing credentials or priority. Persist workflow models with node definitions and invalidate affected outputs when they change. Older clients without a model keep using the provider default. Settings saves preserve the existing provider model for compatibility.

## Acceptance Criteria For Changes

- Active source, source order, and missing source states are visible.
- Saved secrets are masked on read.
- Successful saves refresh the active provider and close Settings. Failed saves keep the dialog open with an error.
- Saving without replacing a key preserves it. An empty replacement requires a new key or cancellation.
- Invalid URLs stay in the open form with an English error. HTTP and HTTPS custom endpoints remain supported.
- Provider errors are actionable and localized.
- Security rules in `docs/SECURITY.md` are preserved.
