# Design Quality Guide

Use this document before changing visible UI, interaction states, copy hierarchy, or canvas behavior in `apps/web`.

## Product Direction

`gpt-image-canvas` should feel like a calm local creative workstation, not a generic SaaS dashboard or marketing page. The first impression should be the working canvas, generated imagery, provider readiness, and local control.

The current visual language is warm paper, dark ink, copper accent, teal focus, and editorial typography. Keep new work aligned with the tokens in `apps/web/src/styles/tokens.css` unless a product spec explicitly changes the brand direction.

## Core Rules

- Preserve the app-first experience. Do not add landing-page hero sections for core workflows.
- Use the existing paper and ink palette. Avoid generic SaaS blue, purple gradients, glass effects, decorative blobs, or unrelated atmospheric backgrounds.
- Keep tool surfaces dense, scannable, and stable. This is a repeated-use creative tool, so controls should be quick to inspect and hard to misread.
- For fine interaction polish, follow `docs/design-docs/interaction-quality.md`: balanced headings, pretty short copy, tabular dynamic numbers, neutral image outlines, tactile press feedback, explicit transitions, and adequate hit areas.
- For reusable UI motion, follow `docs/design-docs/motion-recipes.md`: state-driven recipes, semantic motion knobs, open/close timing, reduced-motion guards, and layout-stable feedback.
- Use cards only for repeated items, modals, and framed tools. Do not nest cards inside cards or wrap full page sections as floating cards.
- Let real content carry the design: canvas images, thumbnails, generation records, provider state, and plan nodes.
- Prefer familiar icons from `lucide-react` for compact commands, especially in toolbars, status rows, and action buttons.
- Use visible labels where ambiguity would slow users down. Icon-only controls need accessible labels and tooltips when their action is not obvious.
- Keep text inside controls responsive and readable. Long labels should wrap or use a narrower copy treatment rather than overflow.

## Visual Language

- Base surfaces: paper, paper-soft, paper-panel, canvas-paper.
- Primary text: ink. Secondary text: muted-ink.
- Action accent: copper. Focus and success: teal. Errors: danger red. Warnings: warm amber.
- Typography: `--font-ui` for UI, `--font-editorial` for expressive brand moments, and `--font-mono` for IDs, technical values, and compact metadata.
- Motion should clarify state, not delay action. Use quick feedback for hover, focus, loading, success, and error states.

## Interaction Standards

- Canvas interactions should prioritize direct manipulation: select, place, locate, rerun, retry, download, and inspect without forcing users through extra screens.
- Provider and Agent configuration should make trust visible: show whether a source is available, which source is active, and whether secrets are masked.
- Agent plan UI must keep the human in control. Plans are drafts until confirmed, and execution progress should stay inspectable.
- Gallery and history views should keep prompts, outputs, local assets, and cloud upload status connected.

## Accessibility

- Keep keyboard access and visible focus states for all custom controls.
- Minimum touch target is 44 by 44 CSS pixels for mobile controls.
- Do not communicate status through color alone. Pair color with icon, label, or both.
- Preserve semantic structure for forms, dialogs, buttons, and lists.

## Verification

For UI changes, run `pnpm dev` and verify the Vite app at `http://localhost:5173`. Check at least one desktop viewport and one mobile viewport, and confirm that no text overlaps or becomes unreadable.
