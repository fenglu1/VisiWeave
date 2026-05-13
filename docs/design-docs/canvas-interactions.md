# Canvas Interactions

## Direct Manipulation

Users should work with images and plan nodes directly on the canvas. Prefer select, locate, retry, rerun, and inspect actions close to the object they affect.

## Reference Selection

Selected canvas images can become generation references. UI should make the selected reference count clear and avoid sending stale or invisible selections.

Reference editing should preserve the original subject, composition, perspective, and intended role unless the user asks for a replacement image.

## Plan Nodes

Agent plan nodes should show enough structure for a user to trust execution:

- Plan title and status.
- Jobs and output count.
- Failed or blocked job indicators.
- Execute, retry failed, and cancel affordances when relevant.
- Generated previews as they arrive.

## Loading And Failure

Generation can be slow. Use stable placeholders and progress states rather than shifting layouts.

Failures should be recoverable. Keep partial success visible and offer a path to retry failed work without erasing successful outputs.

