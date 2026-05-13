# Visual Language

## Palette

Use the tokens in `apps/web/src/styles/tokens.css`:

- Paper surfaces: `--paper`, `--paper-soft`, `--paper-panel`, `--canvas-paper`.
- Ink text: `--ink`, `--muted-ink`.
- Lines: `--line`, `--line-strong`.
- Actions: `--accent`, `--accent-dark`.
- Focus and success: `--focus`, `--focus-soft`, `--success`.
- Risk states: `--danger`, `--warning`.

Avoid introducing unrelated dominant palettes. New colors need a functional role and should not make the app read as generic SaaS.

## Type

- Use `--font-ui` for controls, forms, panels, lists, and body copy.
- Use `--font-editorial` only for expressive headings or brand moments.
- Use `--font-mono` for IDs, technical metadata, and compact diagnostics.

Do not scale type with viewport width. Prefer discrete responsive steps and ensure labels fit on mobile.

## Surfaces

- Canvas-adjacent panels should be clear and practical.
- Dialogs should keep primary action, destructive action, and cancel action visually distinct.
- Repeated items such as gallery assets and plan jobs may use card styling.
- Avoid nested cards and full-page floating card sections.

## State

Every important state should have a visible treatment:

- Missing provider.
- Provider available.
- Generating.
- Uploading or cloud upload failed.
- Plan awaiting confirmation.
- Job running, failed, blocked, cancelled, or succeeded.
- Selection, hover, focus, and disabled controls.

