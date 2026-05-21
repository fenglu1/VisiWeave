# Tasks: Add Creative Video Generation

## Status Summary

### 已完成

- Shared video contracts, API validation, SQLite persistence, provider abstraction, async job processing, video asset storage, and video delete/download behavior are implemented.
- Creative Video and Video Library top-level workspaces are implemented, with navigation order `Home`, `Canvas`, `Gallery`, `Creative Video`, `Video Library`.
- Text-to-video and image-to-video flows are implemented, including Gallery/Canvas image handoff into Creative Video.
- Generated videos are stored and displayed in Video Library only; Gallery remains image-only.
- Chinese and English UI copy, provider status handling, desktop layout, and mobile responsive behavior are implemented.
- API smoke checks, typecheck, build, and browser verification were completed for the current implementation.

### 未完成

- Optional best-effort `POST /api/videos/:jobId/cancel` has not been implemented.
- Formal unit tests for shared validation and API request parsing have not been added yet.

### 需优化

- Add dedicated video poster/thumbnail extraction so Video Library cards can show a stable first-frame preview before playback.
- Add an in-app video provider configuration editor if runtime editing is needed; the current implementation reads video provider settings from environment variables.
- Add production-specific provider adapters and richer progress metadata after the target video backend is finalized.
- Consider route-level chunk splitting to reduce the current Vite bundle-size warning.

### 需测试

- Test against the real target provider, including text-to-video and image-to-video jobs that take around 10 seconds or longer.
- Test image-to-video with real generated Gallery/Canvas assets and with missing/deleted reference assets.
- Re-test Video Library playback, download, delete, and detail modal in the user's normal desktop and mobile browsers.
- Re-test existing user data migration on a representative local database before release.

## 1. Contracts And Validation

- [x] Add shared video generation types in `packages/shared`.
- [x] Add video library item types for generated videos.
- [x] Add request validation for text-to-video and image-to-video inputs.
- [x] Add stable video provider and job error codes.

## 2. Persistence And Assets

- [x] Add SQLite schema changes for video jobs, outputs, and video asset metadata.
- [x] Add migration behavior that preserves existing image records and assets.
- [x] Persist generated video files only under `DATA_DIR/assets`.
- [x] Store duration, dimensions, MIME type, prompt, mode, provider, status, error, and reference asset id.
- [x] Ensure delete behavior removes or detaches video outputs consistently with local asset rules.

## 3. Video Provider Layer

- [x] Add a `VideoProvider` interface.
- [x] Implement an initial custom HTTP or ComfyUI-compatible adapter.
- [x] Support text-to-video provider calls.
- [x] Support image-to-video provider calls with a local generated image reference.
- [x] Sanitize provider errors and avoid logging secrets.
- [x] Add provider status/configuration behavior for the UI.

## 4. API Routes

- [x] Add `POST /api/videos/generate`.
- [x] Add `GET /api/videos/:jobId`.
- [ ] Add optional best-effort `POST /api/videos/:jobId/cancel`.
- [x] Add video library retrieval for completed and failed video records.
- [x] Add delete/download behavior for video outputs.

## 5. Web UI

- [x] Add `Creative Video` top navigation entry immediately to the right of `Gallery`.
- [x] Add `Video Library` top navigation entry immediately to the right of `Creative Video`.
- [x] Add a Creative Video route/workspace.
- [x] Add a Video Library route/workspace.
- [x] Build text-to-video mode with prompt, duration default `10s`, aspect ratio, provider status, and generate action.
- [x] Build image-to-video mode with image picker/preloaded image, motion prompt, duration default `10s`, provider status, and generate action.
- [x] Add Gallery/image action to start image-to-video from an existing generated image.
- [x] Render video cards and detail playback in Video Library.
- [x] Keep Gallery image-only after video generation succeeds.
- [x] Add localized Chinese and English UI strings.
- [x] Add responsive styles for desktop and mobile.

## 6. Testing And Verification

- [ ] Add unit tests for shared validation and API request parsing where existing test patterns support it.
- [x] Add API-level checks for missing provider, invalid prompt, missing reference asset, failed provider job, and successful output persistence.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm build`.
- [x] Run dev server and verify the UI. Note: this session used `http://127.0.0.1:5174` because `5173` was occupied by another local app.
- [x] Verify desktop navigation placement: `Creative Video` is in the same row and immediately right of `Gallery`, and `Video Library` is immediately right of `Creative Video`.
- [x] Verify mobile navigation, Creative Video form layout, Video Library cards, and video detail playback.
