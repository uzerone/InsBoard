# Product Sense Guide

Use this before changing product behavior, user flows, prompt planning, provider configuration, local storage, or onboarding.

## Product Promise

`InsBoard` is a personal GPT Image workstation built around an infinite canvas. Image generation may connect through an OpenAI-compatible endpoint. Local SQLite storage and connected generation nodes support the canvas workflow.

The product should help users move from intent to usable image assets without losing control of prompts, references, plans, outputs, or credentials.

## Primary Users

- The owner arranging images and connected generation nodes in a private desktop workspace.
- The owner's repeated prompt, reference, and generation workflows determine the interface; ComfyUI is a reference for direct canvas interaction.

## Product Principles

- Local first: project state, generation records, provider settings, generated assets, and optional credentials live on the user's machine.
- Creator control: every plan can be inspected before execution. Users decide when to execute, retry, cancel, rerun, download, or locate assets.
- Reference fidelity: when selected canvas images are used as references, preserve their subject, composition, and intended role unless the user asks otherwise.
- Trust over magic: make active provider, credential state, errors, and missing configuration visible.
- Useful defaults: default generation settings should be fast enough to try and clear enough to upgrade to higher quality.
- Recoverable workflows: failed jobs, blocked jobs, and missing providers should lead to clear next actions.

## Core Workflows

### Prompt To Image

The manual flow should let users enter a prompt, choose size, quality, output format, count, and style preset, then place generated assets on the canvas. Generation records should preserve the request, effective prompt, outputs, and errors.

The right sidebar contains image creation controls and follows selected images or a single workflow node while preserving the manual draft. Keep frequent settings visible, advanced options collapsed, and the primary action accessible without scrolling. Context changes and prompt suggestions must never start generation automatically.

Place newly generated images at their actual pixel dimensions. Fit the viewport separately, and render the original image file on the canvas; compressed thumbnails are for compact history lists. Adding a workflow node preserves the current zoom and pans only when needed to reveal it. Text and SVG controls must render at the current zoom rather than enlarging a cached texture. Workflow nodes support proportional corner scaling, saved with the project. Command-Z undoes canvas edits and Shift-Command-Z redoes them; text fields keep native text undo. Generation runtime transitions are not editable history. A failed saved-project load blocks canvas editing until it can be retried safely.

Open and Save belong beside the app name in the upper-left toolbar. Omit persistent tutorials, starter suggestions, and repeated helper copy. Keep concise labels, operational state, and actionable failure details.

### Reference Image Editing

Use a single generation form. Selecting canvas images adds inline references; clearing references returns to text-only generation without losing the prompt, model or output settings. Do not add separate creation/editing tabs or duplicate instructions.

When the user selects canvas images and asks to edit, polish, add text, create variations, or redesign based on them, the app should treat selected images as the source of truth. Generated outputs should stay connected to their reference assets.

### Connected Workflows

Users create and connect generation nodes explicitly. Workflows require only the Image API. Keep dependency execution, retry, cancellation, and saved canvas restoration available.

Agent chat, planning, skills, and History browsing are removed. Existing image assets and generation records remain available for active-job recovery and portable projects.

### Provider Configuration

Provider configuration is part of the product, not an admin afterthought. Users should understand the source order: environment OpenAI-compatible config, local OpenAI-compatible config. Settings only exposes the Image API.

## Anti-Patterns

- Do not hide provider or credential problems behind generic failure messages.
- Do not invent selected image contents when vision is not available.
- Do not make onboarding require credentials before the user can understand the app.

## Asset integrity

Keep image files, asset-owned prompt metadata and canvas content independent of generation-record cleanup. Image info exposes the original and effective prompts; imported images without generation metadata have an explicit empty state. Portable projects preserve this metadata. Resizing preserves the source aspect ratio, including legacy stretched images. Preview resolution follows displayed size, zoom and pixel density; use the original when a preview would limit detail.
