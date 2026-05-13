# Agent Canvas Generation

## Goal

Turn a creator request into an inspectable multi-image generation plan, then execute it onto the canvas with dependency-aware progress and recoverable failures.

## Current Product Shape

- The Agent tab accepts a user message, selected canvas references, default output settings, and planner options.
- The API planner returns a strict `GenerationPlan` or a user question.
- A plan node appears on the canvas before execution.
- Execution runs jobs according to dependencies and streams status back through WebSocket events.

## Plan Rules

- The plan is only a plan until the user confirms execution.
- Total generated images across all jobs must be 16 or fewer.
- Each job may use at most 3 resolved reference images.
- A generated output used as a downstream dependency must come from a source job with count `1`.
- Generated anchors are visible canvas images and count against the image cap.
- If `supportsVision` is false, selected images are handles and summaries only. Do not claim to inspect image contents.

## Selected Reference Behavior

When selected references exist and the user asks to edit, add text, redesign, polish, or create variants from the selected images, assume the selected images are the source. Preserve original content unless the user explicitly asks to replace it.

For batch edits, prefer one final-image job per selected reference.

## Acceptance Criteria For Changes

- Plan validation rejects invalid jobs, edges, references, and caps.
- Plan nodes remain inspectable before and during execution.
- Failed jobs can be retried without rerunning successful upstream jobs.
- Cancellation leaves understandable state.
- Browser verification covers plan creation, execution, and failure or retry behavior when UI changes.

