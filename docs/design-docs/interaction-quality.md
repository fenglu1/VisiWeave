# Interaction Quality

Use this guide when polishing visible UI in `apps/web`: buttons, toolbars, Gallery cards, provider configuration, Agent panels, dialogs, thumbnails, and tldraw-adjacent controls.

This is a project-specific distillation of small design engineering details. Do not copy external skill text into the repo; turn it into rules that fit the warm paper, ink, copper, teal, and tldraw canvas interface.

## Product Fit

`gpt-image-canvas` should feel calm, tactile, and trustworthy. Interaction polish should make the tool feel more responsive without making it flashy.

- Keep the current visual system: paper surfaces, dark ink text, copper action states, teal focus, and neutral image edges.
- Prefer small, interruptible state changes over decorative animation.
- Keep creator workflows stable. Hover, press, loading, success, failure, and disabled states should not resize the layout.
- Avoid introducing a new motion dependency for polish. This repo does not currently use `motion` or `framer-motion`; use CSS transitions unless a future product story explicitly justifies a library.

## Typography

- Apply font smoothing at the root, not per component:
  - `-webkit-font-smoothing: antialiased`
  - `-moz-osx-font-smoothing: grayscale`
- Use `text-wrap: balance` for short headings, panel titles, modal titles, and brand-like labels.
- Use `text-wrap: pretty` for short-to-medium paragraphs, captions, list copy, prompts, and card descriptions.
- Do not use balanced wrapping on long bodies, logs, code, tables, or virtualized content.
- Do not scale font size directly with viewport width. Use discrete responsive steps.

Project examples:

- Gallery and modal titles can balance.
- Provider descriptions and Agent message text can use pretty wrapping.
- Prompt text should remain readable, but do not force long generated prompts into balanced headings.

## Dynamic Numbers

Use `font-variant-numeric: tabular-nums` for numbers that update, align, or sit in dense metadata.

Good targets:

- Gallery counts, dimensions, timestamps, and file sizes.
- Generation history status metadata.
- Agent job counts, job IDs, elapsed times, and output counts.
- Provider priority ranks, masked secret lengths, health metrics, and retry counters.

Avoid it for decorative numerals, phone-like strings, prose, and brand copy unless alignment matters.

## Surfaces

Rounded surfaces should feel intentional, especially when one rounded element sits inside another.

- For tight nested surfaces, use concentric radius math: outer radius equals inner radius plus the padding between them.
- Do not force this rule when padding is large; separate surfaces may use independent radii.
- Keep cards at `8px` radius or less unless an existing component already uses a larger project-specific radius.
- Prefer shadows for elevation and image/card depth. Keep layout dividers and input outlines as borders when they communicate structure or accessibility.
- Do not nest cards inside cards.

## Image Edges

Generated images and references need a neutral edge so they read clearly on paper and dark surfaces.

- Use `outline: 1px solid var(--image-outline)` with `outline-offset: -1px`.
- In light mode, `--image-outline` should be `rgba(0, 0, 0, 0.1)`.
- In dark mode, `--image-outline` should be `rgba(255, 255, 255, 0.1)`.
- Do not use tinted palette neutrals, accent colors, or ink colors for image outlines.
- Apply this to app-owned image surfaces: Gallery images, reference previews, Agent output thumbs, and home previews.
- Be careful with tldraw internals. Do not override tldraw image selection styles unless the story is explicitly about canvas rendering.

## Motion

Interactive state changes must be interruptible.

- Use CSS transitions for hover, active, focus, open, close, toggle, and selected states.
- Reserve keyframes for one-shot staged entrance or loading sequences.
- Keep durations short: `120ms` to `180ms` for controls, up to `300ms` for larger panel movement.
- Use explicit transition properties. Never use `transition: all` in authored CSS.
- Prefer `transform`, `opacity`, and `filter` for visual movement. Avoid animating layout properties like width, height, top, left, padding, or margin.
- Respect `prefers-reduced-motion: reduce`.

Press feedback:

- Use `scale(0.96)` for tactile button press feedback.
- Do not go below `scale(0.95)`.
- Disable or skip press scaling when it would distract during drag, canvas manipulation, or text editing.

Icon state changes:

- Static navigation icons do not need animation.
- Contextual icon swaps can cross-fade with CSS by keeping both icons in the DOM, one positioned over the other.
- Use opacity, scale, and light blur for icon swaps; do not just toggle display when the icon carries state.

## Hit Areas

Interactive targets should be easy to hit on desktop and mobile.

- Aim for `44px` by `44px` for mobile controls, and at least `40px` by `40px` for compact desktop controls.
- If the visible icon is smaller, extend the hit area with a pseudo-element.
- Do not let expanded hit areas overlap neighboring interactive controls.
- Icon-only controls must have accessible names and tooltips when the action is not obvious.

Good targets:

- Gallery action buttons.
- Provider config icon controls.
- Agent copy, retry, cancel, expand, and preview controls.
- History row icon actions.
- Canvas overlay controls.

## Optical Alignment

Geometric centering is not always visually centered.

- Text-plus-icon buttons may need slightly less padding on the icon side.
- Carets, arrows, and play-like shapes may need a small optical shift.
- Prefer fixing repeated icon alignment in the component or SVG wrapper instead of one-off margins scattered across feature CSS.

## Performance

- Use `will-change` only when a specific element has visible first-frame stutter.
- Limit `will-change` to compositor-friendly properties: `transform`, `opacity`, and `filter`.
- Never use `will-change: all`.
- Remove `will-change` after temporary animations if the element is not frequently animated.
- Verify polish on real pages instead of trusting static inspection. Gallery can contain hundreds of images, and Agent plans can grow quickly.

## Implementation Checklist

- Typography: headings balance, short body copy uses pretty wrapping, root smoothing is applied once.
- Numbers: dynamic counts and dense metadata use tabular numerals.
- Surfaces: nested radii look concentric where surfaces are tight.
- Images: app-owned images use neutral inset outlines in both light and dark themes.
- Motion: interactive changes use CSS transitions, not keyframes.
- Transitions: no new `transition: all` rules.
- Press: buttons use `scale(0.96)` only where tactile feedback helps.
- Hit areas: compact icon controls reach at least `40px` by `40px` without collisions.
- Accessibility: focus states remain visible, labels remain readable, and color is not the only status cue.
- Verification: check one desktop viewport and one mobile viewport in `http://localhost:5173` or the actual Vite port in use.

## Review Format

When reporting interaction-polish changes, group them by principle and use a concise Before/After table:

| Principle | Before | After |
| --- | --- | --- |
| Typography | Heading used default wrapping | Added `text-wrap: balance` to the project heading selector |
| Hit area | Visible icon button was smaller than `40px` | Added a pseudo-element hit target without changing layout |

Mention any principle you intentionally skipped only when it matters for the story.
