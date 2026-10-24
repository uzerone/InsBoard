# Canvas Interactions

## What the workspace must protect

An existing image or node is user work at a chosen location. A generation request adds new objects. Generation finishes asynchronously, while the user may already be editing something else. These facts lead to three constraints: automatic placement must not obscure or relocate existing objects; related source and result objects must remain easy to compare; background completion must not take over current navigation, focus or selection.

Right-of-source placement and a grid are preferred layouts, not requirements that override those constraints. Use the largest readable arrangement that fits the available viewport, then find unoccupied space for the group. If the preferred area is occupied, choose a nearby clear area rather than moving existing work.

## Placement and comparison

- Reserve real output dimensions before submission. Keep batch slots in an ordered group with consistent gaps and room for labels.
- Account for all existing images, nodes and pending slots, including other simultaneous requests.
- For reference editing, use live canvas bounds, not original image pixel dimensions or stale selection coordinates. Initial framing includes both references and the output group.
- Recheck actual output dimensions and current obstacles when results arrive: provider dimensions or user positions may have changed during generation.
- Preserve the original reference and prompt provenance. Auto-arrangement applies only to new objects.
- New workflow nodes, placed workflow outputs and imported images use the same vacant-space rule.

## Navigation and selection

- Pan and zoom change the viewport, not document geometry. Browser page zoom must not compete with canvas zoom.
- Shift+1 fits the whole project. Shift+G toggles 24 px world-coordinate snapping; Option/Alt temporarily bypasses snapping. A group keeps its internal offsets.
- Selected workflow nodes expose proportional corner scaling. Contents and ports follow the saved size; resizing does not change generation resolution.
- Hide corner resize controls when an object's shorter edge is below 32 screen pixels. At project overview scale, controls must not cover nearby objects; zoom in to resize.
- Keep selection on the same reference or other object when a background request completes. Transfer selection to a generated result only when its replaced placeholder is still selected.
- Reframe at the user's generation or locate action. Do not change the camera merely because a background result arrived.

## Editing and recovery

- Command/Control-Z undoes canvas edits; Shift-Command/Control-Z redoes them. One drag, resize or typing session is one step. Inputs retain native text undo while focused.
- Generation lifecycle is not user-editable history. Undo must not start or resurrect a request, remove durable asset metadata, or pair a prompt with an unrelated result.
- Batch structural changes into one document publication so intermediate delete/create states are not rendered separately.
- Block editing and saving after a failed project load. Offer a retry instead of an editable empty fallback that could replace saved work.
- Generation must not require a notification permission prompt. Already-authorized desktop notifications are optional; notification service failures must not mark a successful generation as failed.
- Keep loading geometry stable, preserve partial successes, and show actionable errors. Avoid decorative effects that repaint the entire canvas during navigation.

## Evidence and remaining limits

`tests/canvas-history.test.ts`, `tests/canvas-grid.test.ts` and `tests/canvas-placement.test.ts` verify history/runtime boundaries, snapping, saved scale, collision avoidance, larger returned images and selection protection. Browser verification covers desktop/mobile controls and visible placement. Continuous physical trackpad/compositor behavior still needs device observation; keyboard zoom checks alone do not prove every pinch frame is free of flicker.
