# New User Onboarding

## Goal

Help a first-time local user understand the app, configure a usable image provider, and reach the canvas without exposing secrets or hiding missing-provider states.

## Current Product Shape

- `/` is credential-aware.
- `/canvas` is the working canvas and requires a usable provider.
- `/gallery` remains available without credentials so local outputs can be viewed.
- Provider options include environment OpenAI-compatible config, local OpenAI-compatible config, and Codex login fallback.

## Quality Rules

- Missing provider state should be clear and actionable.
- Environment values are read-only in the UI.
- Local provider keys are stored in SQLite and returned only as masked values.
- Users should not need to understand Docker, SQLite, or internal routes to start.
- If credentials are absent, generation actions should fail with a clear `missing_provider` style message rather than a generic error.

## Acceptance Criteria For Changes

- A user can identify whether an image provider is configured.
- A user can reach provider setup from the homepage or canvas blocking state.
- Gallery remains reachable without credentials.
- UI changes are verified at `http://localhost:5173` on desktop and mobile.

