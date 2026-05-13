# Core Design Beliefs

## The Canvas Is The Product

The primary surface is the working tldraw canvas. Navigation, provider state, Agent controls, history, and Gallery should support the canvas rather than compete with it.

## Local Control Builds Trust

Users should understand where credentials and generated files live. Provider configuration, cloud backup, and Codex login should make local storage and masking rules visible.

## Plans Should Be Inspectable

Agent output is useful because it becomes a visible plan node with jobs, dependencies, status, and retry behavior. Do not hide plan structure behind vague assistant messages.

## Images Are Working Assets

Generated outputs are not decorative samples. The UI should make them easy to place, locate, download, rerun, inspect, and use as references.

## Quiet Tools Beat Loud Decoration

The app should feel focused, warm, and professional. Use visual polish to improve scanning and feedback, not to decorate empty space.

