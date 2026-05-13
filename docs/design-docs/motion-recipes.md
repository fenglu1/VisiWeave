# Motion Recipe Rules

Use this guide before adding or reworking UI motion in `apps/web`.

This is a project-specific distillation of patterns from `transitions.dev`. Do not paste those snippets directly into this app. Translate the recipe into this repo's tokens, component boundaries, accessibility rules, and warm paper visual system.

## Core Principles

- Treat motion as feedback for a state change, not decoration. It should explain what opened, closed, swapped, finished, failed, or became selectable.
- Name each motion recipe after the user-facing job: badge reveal, icon swap, text swap, panel reveal, modal open, page step, counter pop, or intentional resize.
- Keep recipes state-driven. Prefer `data-*` state, `aria-*` state, and explicit classes such as `.is-open`, `.is-closing`, `.is-exit`, `.is-enter-start`, or `.is-animating`.
- Use semantic custom properties for motion knobs: duration, close duration, distance, blur, scale, stagger, and easing. Keep them near the component unless they are truly shared.
- Scope selectors to the feature or component. Avoid global portable prefixes such as `.t-*` in app CSS; those are useful for copyable demos, not for this product.
- Emit only the properties needed for the motion. Do not mix motion recipes with unrelated colors, shadows, spacing, or typography.
- Every recipe needs a `prefers-reduced-motion: reduce` path.

## Timing Scale

| Use case | Baseline | Notes |
| --- | --- | --- |
| Control hover, press, focus, selected | `120ms` to `160ms` | Use explicit property transitions. |
| Icon or text swap | `180ms` to `220ms` | Cross-fade with light blur and scale or translate. |
| Dropdown or small popover open | `220ms` to `260ms` | Close faster, usually `140ms` to `180ms`. |
| Modal open or close | `220ms` to `260ms` open, `140ms` to `180ms` close | Use scale plus opacity, with scroll lock and Escape handling. |
| Page or panel step | `200ms` to `300ms` | Use direction-aware translate plus opacity. Exceed `300ms` only when the distance is large and the action is not urgent. |
| Staged number or badge pop | `300ms` to `500ms` | Use sparingly and only for small elements. |

Preferred eases:

- General open or slide: `cubic-bezier(0.22, 1, 0.36, 1)`.
- Simple close: `cubic-bezier(0.4, 0, 0.2, 1)` or the same ease as open with a shorter duration.
- Small pop only: `cubic-bezier(0.34, 1.36, 0.64, 1)`. Keep bounce subtle in this app.

## Property Rules

- Prefer `transform`, `opacity`, and `filter` for visible movement.
- Use light blur only when it clarifies a swap or depth change. Typical values are `2px` to `4px`.
- Use scale changes gently: `0.96` or `0.97` for modals and popovers, `0.25` only for tiny icon swaps.
- Use movement distances around `8px` to `16px` for compact UI. Larger panels should move enough to read clearly, but not so far that the interface feels slow.
- Avoid animating layout properties such as `width`, `height`, `padding`, `margin`, `top`, and `left`.
- Exception: animate `width` or `height` only when resize is the subject of the interaction. Keep the changing element isolated, keep controls anchored, and verify no surrounding layout jitters.
- Never author `transition: all`.
- Use `will-change` only on elements that visibly stutter and only for `transform`, `opacity`, or `filter`. Remove it when the element is not frequently animated.

## State Machines

Open and close:

- Keep mounted content in a closing state long enough for its close animation.
- Swap `.is-open` to `.is-closing`, then remove `.is-closing` after the close duration.
- Disable interaction on hidden or closing content with `pointer-events: none`.

Binary swaps:

- Keep both visual states in the DOM when swapping icons, labels, or compact status values.
- Stack them in the same grid cell or absolute position.
- Drive visibility with a single `data-state` value on the wrapper.

Text swaps:

- Exit the old text with translate, blur, and opacity.
- Change the text while transitions are disabled in an enter-start state.
- Force the next frame before returning to the resting state.
- Avoid text swaps for long generated prompts, logs, tables, or virtualized content.

Replayable pops:

- Use keyframes for one-shot staged entrances such as badge or digit pop-ins.
- Replay by removing the animation class, changing the content, forcing a reflow, then re-adding the animation class.
- Use `data-stagger` only when the order communicates meaning.

## Recipe Catalog

| Pattern | Use It For | Recipe |
| --- | --- | --- |
| Badge reveal | Notification, count, provider health chip | Keep the trigger still. Animate only the badge wrapper and dot with translate, scale, opacity, and light blur. |
| Dropdown | Menus, compact source pickers, status menus | Scale and fade from the trigger-side `transform-origin`; use `.is-open` and `.is-closing`. |
| Modal | Provider config, asset details, destructive confirmation | Scale from `0.96` plus opacity. Lock body scroll, close on Escape, and restore focus. |
| Panel reveal | Side panels, inline advanced settings, collapsible Agent details | Translate on one axis, fade, and optionally blur. Put clipping on a wrapper, not the animated panel if shadows need room. |
| Page step | Multi-step flows inside a stable frame | Overlay pages in the same container, set inactive pages to `pointer-events: none`, and use direction-specific translate. |
| Icon swap | Copy to copied, theme toggle, send to cancel | Stack both icons permanently. Cross-fade with scale and light blur instead of swapping display. |
| Text swap | Short status labels, copy feedback, compact button text | Use a three-phase exit, replace, enter sequence. Keep the container width stable or measure both labels. |
| Number pop | Small changing counters where change should be noticed | Split meaningful digits, use tabular numbers, add small stagger, and mark the container with `aria-live` when users need the update. |
| Intentional resize | A card or panel whose changing size is the point | Animate only the subject's width and height. Pin nearby controls so the user's target does not move. |

## Accessibility And Input

- Keep all controls keyboard reachable with visible focus states.
- Use real buttons, links, dialogs, tabs, and menus before adding roles by hand.
- Do not assign `role="button"` to a focusable card that contains real buttons. Make the card keyboard reachable, then handle Enter and Space on the card itself.
- Dialogs need `role="dialog"`, `aria-modal="true"`, a label, Escape close, outside close when appropriate, scroll lock, and focus restoration.
- Tabs need `role="tablist"`, `role="tab"`, and accurate `aria-selected`.
- Copy and completion feedback should update the accessible name or live text, not just the icon.
- Dynamic counters that matter should use `aria-live="polite"` and `font-variant-numeric: tabular-nums`.
- Gate hover-only polish with `@media (hover: hover)`. Touch devices need explicit tap states so sticky hover does not trap the UI in a hover pose.
- Do not make motion the only status signal. Pair it with icon, label, text, or accessible state.

## Overflow And Layout Stability

- Separate the clipping surface from the surface that needs to let tooltips, popovers, or shadows escape.
- Keep repeated cards, thumbnails, toolbars, counters, and staged demos at stable dimensions.
- Do not let "Copied", error, loading, or translated labels resize a button mid-interaction.
- For scrollable code, logs, and long panels, keep the copy/action button outside the scroll clipping box.
- Use edge fades only when content is actually hidden above or below.
- Set `transform-origin` from the user's perceived source: the trigger edge for dropdowns, center for modals, direction for page transitions, and badge resting point for badge motion.

## Implementation Checklist

- The motion has a named job and a clear state source.
- Durations, distances, scale, blur, stagger, and easing are semantic variables or local constants.
- Transitions list explicit properties and do not use `transition: all`.
- Hidden and closing states block pointer events.
- Reduced motion disables animation or removes transform and blur.
- Hover polish is gated for pointer-capable devices, and touch has its own feedback path.
- Focus, Escape, live regions, labels, and selected states are correct.
- Layout stays stable on desktop and mobile, including translated labels and copied states.
- Browser verification covers one desktop and one mobile viewport for UI changes.
