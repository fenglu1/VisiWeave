# Creative Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add top-level Creative Video and Video Library workspaces, supporting prompt-to-video and image-to-video job records while keeping Gallery image-only.

**Architecture:** Add shared video contracts, API routes, SQLite tables, and a custom HTTP video provider path that produces persisted async job records. Add dedicated web pages for Creative Video and Video Library, with Gallery only providing an image-to-video handoff.

**Current status:** Core implementation is complete. Remaining work is provider-specific hardening, formal unit tests around validation/parsing, optional cancellation support, and real-provider/mobile regression testing before release.

**Tech Stack:** TypeScript, React 18, Vite, Hono, Drizzle ORM, SQLite, existing local asset storage, CSS modules-by-stylesheet.

---

### Task 1: Shared Contracts And API Video Core

**Files:**
- Create: `packages/shared/src/video.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/api/src/infrastructure/schema.ts`
- Modify: `apps/api/src/infrastructure/database.ts`
- Modify: `apps/api/src/server/http/validation.ts`
- Create: `apps/api/src/domain/video/video-generation.ts`
- Create: `apps/api/src/server/routes/videos.ts`
- Modify: `apps/api/src/server/app.ts`

- [x] Add video generation request/response contracts.
- [x] Add SQLite tables for video generation records and outputs.
- [x] Add request validation for text-to-video and image-to-video.
- [x] Implement `POST /api/videos/generate`, `GET /api/videos/:jobId`, `GET /api/videos`, and `DELETE /api/videos/:outputId`.
- [x] Implement a custom HTTP provider adapter with text-to-video, image-to-video, polling, binary/data URL/remote URL video handling, and persisted local video assets.
- [ ] Add optional best-effort cancellation route if the selected provider supports cancellation.
- [ ] Add formal unit tests for shared validation and API request parsing.

### Task 2: Creative Video And Video Library UI

**Files:**
- Create: `apps/web/src/features/video/CreativeVideoPage.tsx`
- Create: `apps/web/src/features/video/VideoLibraryPage.tsx`
- Create: `apps/web/src/styles/video.css`
- Modify: `apps/web/src/shared/i18n/index.tsx`

- [x] Build Creative Video with text-to-video and image-to-video modes.
- [x] Load Gallery images for image-to-video selection.
- [x] Submit to `/api/videos/generate`, show job status, and provide a link/action to Video Library.
- [x] Build Video Library list from `/api/videos`, with prompt, mode, duration, copy prompt, download, delete, detail playback, and empty/error/loading states.
- [x] Use existing visual language and accessible controls.
- [ ] Optimize Video Library card previews with extracted poster thumbnails.

### Task 3: Navigation And Gallery Handoff

**Files:**
- Modify: `apps/web/src/features/canvas/CanvasApp.tsx`
- Modify: `apps/web/src/features/gallery/GalleryPage.tsx`
- Modify: `apps/web/src/styles/layout.css`
- Modify: `apps/web/src/styles/gallery.css`
- Modify: `apps/web/src/styles/dark.css`
- Modify: `apps/web/src/styles/responsive.css`

- [x] Add routes `creative-video` and `video-library`.
- [x] Add top navigation order: Home, Canvas, Gallery, Creative Video, Video Library.
- [x] Ensure Creative Video is immediately right of Gallery, and Video Library immediately right of Creative Video.
- [x] Add Gallery image action to open Creative Video in image-to-video mode with the selected asset id.
- [x] Keep `/api/gallery` and Gallery rendering image-only.
- [x] Add lazy loading for video pages.

### Task 4: Integration And Verification

**Files:**
- Review all files changed in Tasks 1-3.

- [x] Resolve TypeScript integration issues.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm build`.
- [x] Run dev server and verify the web app. Note: this session used `http://127.0.0.1:5174` because `5173` was occupied by another local app.
- [x] Browser-check desktop navigation placement, Creative Video form, Gallery image-to-video handoff, Video Library listing/detail/actions.
- [x] Browser-check mobile navigation wrapping and form/library usability.
- [x] Confirm generated videos are not shown in Gallery.
- [ ] Re-test with the real target video provider and representative existing user data before release.
