# Interaction quality

Use this guide for controls, dialogs, workbench panels, image previews and canvas overlays. Use `docs/DESIGN.md` for visual tokens and `docs/design-docs/canvas-interactions.md` for document and navigation behavior.

## Readability and stable layout

- Apply font smoothing once at the root. Balance short headings; use pretty wrapping for short body copy, not logs, code or tables.
- Use discrete responsive type sizes and tabular numerals for dimensions, counts, timestamps and changing status values.
- Keep controls and feedback at stable dimensions. Loading, errors, translated labels and copied states must not move the user's target.
- Use neutral inset image outlines through `--image-outline`; selection styling belongs to the canvas engine.
- Avoid nested cards. Use shared radii and spacing; tight nested surfaces may use outer radius equal to inner radius plus padding.

## Motion

- Motion explains a state change. Keep it small, interruptible and driven by explicit component state.
- Use existing CSS transitions; do not add a motion library for polish.
- Use explicit properties, never `transition: all`. Prefer transform and opacity; avoid blur on large canvas surfaces.
- Controls use about 120–180 ms; panels and dialogs stay below 300 ms and may close faster than they open.
- Reserve keyframes for loading or a one-shot completion reveal. Respect reduced motion with static status feedback.
- Buttons may scale to 0.96 on press; skip this during dragging, canvas manipulation and text editing.
- Stack state icons to cross-fade without changing layout. Hidden or closing content must not intercept input.
- Animate layout dimensions only when resizing is the actual interaction; isolate the subject and anchor nearby controls.
- Use `will-change` only for a measured rendering problem, scope it to the affected property and remove temporary hints afterward.

## Input and accessibility

- Use semantic buttons, dialogs and form controls. Every icon command needs an accessible name and a tooltip when ambiguous.
- Aim for 40 px desktop and 44 px mobile targets. Smaller canvas geometry controls need zoom-aware hit areas that do not overlap neighboring controls.
- Gate hover effects for pointer-capable devices; touch input must not depend on hover.
- Dialogs trap focus, close with Escape when idle, lock background scrolling and restore focus on dismissal.
- Keep visible focus states. Pair status colors with text or icons, and use live text for meaningful asynchronous feedback.
- Separate scrolling/clipping wrappers from controls or popovers that need to escape their bounds.

## Verification

Check the changed interaction at desktop and mobile widths in the running app. Confirm stable layout, keyboard operation, reduced-motion behavior and nonoverlapping hit areas. For canvas controls, also check small and large zoom levels. Run `pnpm check` before completing the change.
