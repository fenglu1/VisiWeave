# Video Provider Active Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the video provider selected in the configuration dialog the real default provider for `/creative-video`, and make the UI clearly show which video configuration is currently in use.

**Architecture:** The backend remains the source of truth for active video provider selection. Saved local video configuration chooses the active default when it exists; environment variables remain a fallback and credential source, not an unconditional override. The web UI adds explicit “Enable” / “In use” controls so selecting a video configuration directly changes the video generation flow used by future jobs.

**Tech Stack:** Hono API in `apps/api`, SQLite via Drizzle, Vite React in `apps/web`, shared TypeScript contracts in `packages/shared`, smoke tests run with `tsx`.

---

## User-Facing Outcome

- In provider settings, each video provider card has a clear action:
  - Saved active provider: `使用中` / `In use`, disabled.
  - Different provider: `启用` / `Enable`.
- Clicking `启用` makes that provider the active saved video configuration. The next video generation request uses that provider's flow.
- After saving Grok Imagine as the video provider, `/creative-video` defaults to Grok Imagine and does not run the keyframe image-generation pipeline first.
- `/grok-imagine` keeps using explicit Grok Imagine behavior.
- Existing Video Library jobs keep their recorded provider. Jobs already created as `keyframe-image` stay `keyframe-image`; only new jobs reflect the saved active provider.
- Video Library items that are still `queued` or `running` for more than 1 hour are treated as stale in-progress items and can be deleted.
- Video Library items that are `queued` or `running` for 1 hour or less remain protected from deletion.
- At high browser zoom or narrow available width, the top navigation remains horizontally scrollable so users can still reach Home, Canvas, Gallery, Video Library, and other routes.
- When navigation space becomes tight enough, text labels collapse and route buttons show icon-only affordances, matching the compact behavior already used by the provider configuration button.
- In the provider configuration dialog, the top tabs for Image, Video, and LLM remain readable and usable at high browser zoom.

## In Scope

- Backend default video provider resolution.
- Provider configuration API response semantics for active video kind.
- Provider settings UI buttons and labels.
- Generic `/creative-video` status and generation behavior.
- Stale in-progress Video Library deletion after 1 hour.
- Responsive top navigation behavior at high zoom and constrained widths.
- Responsive provider configuration dialog tabs at high zoom and constrained widths.
- Regression smoke tests for environment-vs-local selection.
- Browser verification of the provider settings and video workflow.

## Out Of Scope

- Migrating or rewriting existing Video Library records.
- Adding general cancellation/retry tooling for already-running video jobs.
- Changing SQLite schema.
- Changing image provider source order semantics.
- Adding a separate per-page video provider selector outside provider settings.

## Affected Files

- Modify: `apps/api/src/domain/providers/provider-config.ts`
  - Return the saved active video kind when local video config exists.
  - Preserve environment fallback when no local video config has been saved.
  - Avoid treating an image-only provider save as a deliberate video provider selection.
- Modify: `apps/api/src/infrastructure/providers/video-provider.ts`
  - Resolve unscoped video provider status and generation through the saved active local video provider first.
  - Preserve explicit request-level overrides through `providerKind`.
  - Preserve environment-only behavior when there is no saved local video config.
- Modify: `apps/api/src/smoke/grok-imagine-video-provider-smoke.ts`
  - Keep the existing red case.
  - Add default `/api/videos/provider-status` and `/api/videos/generate` checks without `providerKind`.
- Modify: `apps/api/src/smoke/provider-video-config-smoke.ts`
  - Add coverage for saving or preserving active video kind without leaking API keys.
- Modify: `apps/web/src/features/provider-config/ProviderConfigDialog.tsx`
  - Add “Enable” / “In use” actions to video provider cards.
  - Preserve selected provider state from the active saved video kind instead of env-masked effective kind.
  - Keep secret preservation behavior unchanged.
  - Ensure the Image, Video, and LLM tab buttons have layout hooks that support compact or scrollable presentation at high zoom.
- Modify: `apps/web/src/features/video/CreativeVideoPage.tsx`
  - Keep generic `/creative-video` unscoped so it uses backend active selection.
  - Continue passing explicit `providerKind="grok-imagine"` for `/grok-imagine`.
  - Ensure mode switching follows provider capabilities after status refresh.
- Modify: `apps/web/src/features/canvas/CanvasApp.tsx`
  - Add or adjust route button labels so they can be hidden independently from icons in compact navigation mode.
  - Preserve accessible labels and titles when visible text is hidden.
- Modify: `apps/web/src/styles/layout.css`
  - Ensure the top navigation strip can scroll horizontally at high zoom instead of clipping unreachable menu items.
  - Add compact icon-only route button styling at constrained widths.
- Modify: `apps/web/src/styles/responsive.css`
  - Add or refine responsive breakpoints for zoom/narrow-width navigation behavior.
  - Add responsive rules for provider configuration tabs so the three top buttons do not overlap or overflow when zoomed.
- Modify: `apps/web/src/shared/i18n/index.tsx`
  - Add Chinese and English labels for the new button states.
- Test/verify existing: `apps/web/src/smoke/creative-video-page-smoke.ts`
  - Update if needed so provider capability behavior is covered.
- Modify: `apps/api/src/domain/video/video-generation.ts`
  - Allow deletion of stale `queued` or `running` video outputs only when they are older than 1 hour.
  - Keep newer in-progress outputs protected.
- Modify: `apps/api/src/server/routes/videos.ts`
  - Keep the existing `video_output_in_progress` response for protected newer in-progress outputs.
  - Return successful deletion for stale in-progress outputs.
- Modify: `apps/web/src/features/video/VideoLibraryPage.tsx`
  - Enable delete actions for stale in-progress items after 1 hour.
  - Keep delete actions disabled or blocked for newer in-progress items.
- Modify: `apps/web/src/shared/i18n/index.tsx`
  - Add or adjust copy explaining that in-progress videos can be deleted after 1 hour.

## Interfaces And Data

- No SQLite schema change.
- No shared contract change expected.
- Existing request-level `providerKind` remains optional and continues to mean “explicitly use this provider for this request.”
- `/api/provider-config` should expose `video.kind` as the saved active video kind when local video config exists, even if `VIDEO_PROVIDER_KIND` is set.
- `/api/videos/provider-status` without `providerKind` should return the saved active provider when local video config exists.
- `/api/videos/generate` without `providerKind` should record `job.provider` as the saved active provider when local video config exists.

## Implementation Tasks

### Task 1: Lock the backend active-provider semantics with red tests

**Files:**
- Modify: `apps/api/src/smoke/grok-imagine-video-provider-smoke.ts`

- [ ] Add assertions after saving Grok Imagine while `VIDEO_PROVIDER_KIND=keyframe-image`:

```ts
const activeConfig = getProviderConfig();
expect(activeConfig.video.kind === "grok-imagine", "provider config reports saved Grok Imagine as active despite env keyframe config");

const defaultStatusResponse = await app.request("/api/videos/provider-status");
expect(defaultStatusResponse.status === 200, "default provider status request succeeds");
const defaultStatus = (await defaultStatusResponse.json()) as { provider?: { id?: string; configured?: boolean } };
expect(defaultStatus.provider?.id === "grok-imagine", "default provider status uses saved active Grok Imagine config");
expect(defaultStatus.provider.configured === true, "default Grok Imagine provider status is configured");
```

- [ ] Add a default generation request without `providerKind`:

```ts
const defaultCreated = await app.request("/api/videos/generate", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    prompt: "A crystal subway train arriving under moonlight",
    mode: "text_to_video",
    durationSeconds: 5,
    aspectRatio: "16:9"
  })
});
expect(defaultCreated.status === 200, `default video generation request succeeds, got ${defaultCreated.status}`);
const defaultCreatedBody = (await defaultCreated.json()) as VideoGenerationJobResponse;
expect(defaultCreatedBody.job.provider === "grok-imagine", "default video generation records Grok Imagine provider");
```

- [ ] Run:

```powershell
pnpm.cmd --filter @gpt-image-canvas/api smoke:grok-imagine-video
```

Expected before implementation: FAIL because env `keyframe-image` masks the saved Grok Imagine selection.

### Task 2: Make saved local video selection win over environment defaults

**Files:**
- Modify: `apps/api/src/domain/providers/provider-config.ts`
- Modify: `apps/api/src/infrastructure/providers/video-provider.ts`

- [ ] In `provider-config.ts`, change video config source selection so local saved video config wins:

```ts
function videoConfigSource(
  row: ProviderConfigRow | undefined,
  videoRows: VideoProviderConfigRowsByKind
): "environment" | "local" {
  if (row && hasLocalVideoConfig(row, videoRows)) {
    return "local";
  }

  return "environment";
}
```

- [ ] In `saveProviderConfig`, avoid creating a default video selection when the request does not include video config:

```ts
const activeVideoKind = input.video
  ? (parseVideoProviderKind(input.video.kind) ?? parseVideoProviderKind(existing?.videoKind) ?? DEFAULT_VIDEO_PROVIDER_KIND)
  : parseVideoProviderKind(existing?.videoKind);
```

Then store `videoKind: activeVideoKind ?? null`.

- [ ] In `video-provider.ts`, resolve default status in this order:
  - local active video provider from `getLocalVideoProviderConfig()`;
  - env keyframe when `VIDEO_PROVIDER_KIND=keyframe-image`;
  - env Grok Imagine when `VIDEO_PROVIDER_KIND=grok-imagine`;
  - env/custom HTTP fallback.

- [ ] In `video-provider.ts`, resolve default generation provider in the same order.

- [ ] Keep `getRequestedVideoProviderStatus(providerKind)` and `getRequestedConfiguredVideoProvider(providerKind)` explicit override behavior intact.

- [ ] Run:

```powershell
pnpm.cmd --filter @gpt-image-canvas/api smoke:grok-imagine-video
pnpm.cmd --filter @gpt-image-canvas/api exec tsx src/smoke/provider-video-config-smoke.ts
```

Expected after implementation: both PASS.

### Task 3: Add explicit video configuration use buttons

**Files:**
- Modify: `apps/web/src/features/provider-config/ProviderConfigDialog.tsx`
- Modify: `apps/web/src/shared/i18n/index.tsx`

- [ ] Add localized labels:

```ts
providerVideoEnable: "启用",
providerVideoInUse: "使用中",
```

```ts
providerVideoEnable: "Enable",
providerVideoInUse: "In use",
```

- [ ] Track saved active video kind:

```ts
const savedVideoKind = config?.video.kind;
```

- [ ] In each video provider card header, render a button:

```tsx
const isSavedActive = savedVideoKind === videoForm.kind;
const buttonLabel = isSavedActive
  ? t("providerVideoInUse")
  : t("providerVideoEnable");
```

- [ ] Button behavior:
  - `使用中`: disabled.
  - `启用`: saves that provider as the active video configuration and then refreshes provider status.

- [ ] Reuse the same payload-building logic as the existing save button so clicking `启用` preserves secrets, validates numeric fields, sends `video.kind` for that provider, and dispatches `PROVIDER_CONFIG_SAVED_EVENT`.

- [ ] Keep the existing save button for editing provider details without changing the two-state enable model.

### Task 4: Ensure generic video page follows active backend provider

**Files:**
- Modify: `apps/web/src/features/video/CreativeVideoPage.tsx`
- Modify: `apps/web/src/features/canvas/CanvasApp.tsx` only if route wiring needs adjustment.

- [ ] Keep `/creative-video` calling `/api/videos/provider-status` without a query parameter.

- [ ] Keep `/creative-video` submitting `/api/videos/generate` without `providerKind`.

- [ ] Keep `/grok-imagine` as a backwards-compatible alias that lands in `/creative-video`; do not expose a separate Grok top-level page or navigation item.

- [ ] Confirm provider capability effects still work:
  - Grok Imagine: text-to-video enabled, image-to-video disabled.
  - Keyframe image: text-to-video enabled, image-to-video disabled.
  - Custom HTTP: mode availability follows endpoint support.

### Task 5: Verify Video Library behavior and document the non-migration rule

**Files:**
- No production file expected unless the current UI hides provider identity.

- [ ] Inspect `/api/videos` response in the running app.

- [ ] Confirm existing rows created with `provider: "keyframe-image"` remain unchanged.

- [ ] Create or smoke-test a new default Grok Imagine video job and confirm the new row records:

```ts
job.provider === "grok-imagine"
```

- [ ] Explain in the completion note that existing problematic Library jobs are historical records and are not automatically rewritten.

### Task 6: Allow deleting stale in-progress Video Library items after 1 hour

**Files:**
- Modify: `apps/api/src/domain/video/video-generation.ts`
- Modify: `apps/api/src/server/routes/videos.ts`
- Modify: `apps/web/src/features/video/VideoLibraryPage.tsx`
- Modify: `apps/web/src/shared/i18n/index.tsx`

- [ ] Add a backend stale threshold constant:

```ts
const STALE_IN_PROGRESS_DELETE_AFTER_MS = 60 * 60 * 1000;
```

- [ ] Add a helper that treats only old queued/running rows as deletable:

```ts
function isStaleInProgressVideoItem(createdAt: string, nowMs = Date.now()): boolean {
  const createdMs = Date.parse(createdAt);
  return Number.isFinite(createdMs) && nowMs - createdMs >= STALE_IN_PROGRESS_DELETE_AFTER_MS;
}
```

- [ ] Update `deleteVideoOutputById` so protected statuses are skipped only when they are not stale:

```ts
const isProtectedInProgress = PROTECTED_DELETE_STATUSES.has(outputStatus) || PROTECTED_DELETE_STATUSES.has(generationStatus);
if (isProtectedInProgress && !isStaleInProgressVideoItem(output.createdAt)) {
  return "skipped";
}
```

- [ ] Preserve existing asset cleanup behavior for stale in-progress outputs that already have an asset.

- [ ] Keep batch delete semantics unchanged except stale in-progress items now count as `deletedIds` instead of `skippedIds`.

- [ ] Update `VideoLibraryPage.tsx` delete eligibility:

```ts
function canDeleteVideoItem(item: VideoLibraryItem): boolean {
  return isTerminalVideoStatus(item.status) || isStaleInProgressVideoItem(item.createdAt);
}
```

- [ ] Add UI copy for protected newer in-progress items:

```ts
videoDeleteRunningDisabled: "进行中的视频生成 1 小时内暂不可删除，超过 1 小时后可清理。",
```

```ts
videoDeleteRunningDisabled: "In-progress video generations cannot be deleted during the first hour. Stale items can be cleaned up after 1 hour.",
```

- [ ] Add or update a backend smoke test that creates:
  - a running output newer than 1 hour and expects delete to return `skipped`;
  - a running output older than 1 hour and expects delete to return `deleted`;
  - a batch delete request where stale in-progress rows appear in `deletedIds`.

### Task 7: Add zoom-safe horizontal top navigation

**Files:**
- Modify: `apps/web/src/features/canvas/CanvasApp.tsx`
- Modify: `apps/web/src/styles/layout.css`
- Modify: `apps/web/src/styles/responsive.css`

- [ ] Inspect the current top navigation markup and identify the route button text elements for Home, Canvas, Gallery, Creative Video, Grok Imagine, and Video Library.

- [ ] Ensure route buttons keep icon elements visible while wrapping visible text in a hideable label span:

```tsx
<span className="app-nav-button__label">{t("navGallery")}</span>
```

- [ ] Preserve accessibility by keeping existing `aria-label` or `title` attributes on icon-only route buttons:

```tsx
aria-label={t("navGallery")}
title={t("navGallery")}
```

- [ ] Ensure the nav container scrolls horizontally when content exceeds available width:

```css
.app-nav {
  min-width: 0;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  scrollbar-width: thin;
}

.app-nav__items {
  width: max-content;
  min-width: 0;
  flex-wrap: nowrap;
}
```

- [ ] Add compact label hiding for constrained widths:

```css
@media (max-width: 900px) {
  .app-nav-button__label {
    display: none;
  }
}
```

- [ ] Confirm the compact route buttons remain at least `40px` wide and do not collapse below usable touch targets.

- [ ] Confirm horizontal scrolling works after browser zoom reaches the point where route labels are hidden.

### Task 8: Fix provider configuration tabs at high zoom

**Files:**
- Modify: `apps/web/src/features/provider-config/ProviderConfigDialog.tsx`
- Modify: `apps/web/src/styles/layout.css` or the stylesheet that currently owns provider dialog styles
- Modify: `apps/web/src/styles/responsive.css`

- [ ] Inspect the current provider configuration tab markup for the Image, Video, and LLM buttons.

- [ ] Wrap the tab list in a horizontally scrollable container if it can overflow at high zoom:

```tsx
<div className="provider-config-tabs" role="tablist" aria-label={t("providerConfigTabsLabel")}>
  ...
</div>
```

- [ ] Ensure each tab keeps a stable minimum hit area:

```css
.provider-config-tabs button {
  min-height: 40px;
  min-width: max-content;
  white-space: nowrap;
}
```

- [ ] At constrained widths, allow horizontal scrolling instead of squeezing labels:

```css
.provider-config-tabs {
  display: flex;
  gap: 0.5rem;
  min-width: 0;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  scrollbar-width: thin;
}
```

- [ ] If the existing visual treatment cannot fit at high zoom, switch the tab group to equal-height compact pills while preserving the labels `生图`, `视频`, and `大模型`.

- [ ] Verify the active tab state remains visible and keyboard focus remains visible after scrolling.

### Task 9: Full verification

**Commands:**

```powershell
pnpm.cmd --filter @gpt-image-canvas/api smoke:grok-imagine-video
pnpm.cmd --filter @gpt-image-canvas/api exec tsx src/smoke/provider-video-config-smoke.ts
pnpm.cmd --filter @gpt-image-canvas/api exec tsx src/smoke/video-library-delete-smoke.ts
pnpm.cmd --filter @gpt-image-canvas/api exec tsx ..\web\src\smoke\creative-video-page-smoke.ts
pnpm.cmd typecheck
pnpm.cmd build
```

**Browser verification:**

```powershell
pnpm.cmd dev
```

Open `http://127.0.0.1:5173`.

- [ ] Desktop: open provider settings, verify video cards show only `使用中` and `启用`.
- [ ] Desktop: save Grok Imagine as active, open `/creative-video`, verify provider status shows Grok Imagine capability and image-to-video is not selectable.
- [ ] Desktop: open `/video-library`, verify existing jobs keep their original provider and any new smoke-created job records Grok Imagine.
- [ ] Desktop: verify running Video Library items newer than 1 hour cannot be deleted and show the protected in-progress message.
- [ ] Desktop: verify stale running Video Library items older than 1 hour can be deleted.
- [ ] Desktop high zoom: zoom the browser until the top navigation is space-constrained, verify route buttons collapse to icons and can be reached by horizontal scrolling.
- [ ] Desktop high zoom: open provider settings and verify the `生图`, `视频`, and `大模型` tabs remain readable, tappable, and free of overlap.
- [ ] Mobile: verify provider dialog buttons wrap without horizontal scrolling.
- [ ] Mobile: verify provider settings tabs remain usable without clipping.
- [ ] Mobile: verify top navigation remains horizontally scrollable and route buttons stay tappable.

## Risks And Guardrails

- Do not log or expose raw API keys. All API responses must keep masked secrets.
- Do not mutate existing Video Library jobs; the provider field is historical execution data.
- Do not allow deletion of active in-progress jobs younger than 1 hour.
- Treat stale in-progress deletion as cleanup of stuck Library rows, not as full provider job cancellation.
- Do not make env video config unusable. Env-only setups still need to work when no local video config has been saved.
- Do not change image provider source order behavior.
- `启用` is allowed to persist the active video provider immediately because the product requirement is that selecting a provider changes the corresponding video generation flow.

## Acceptance Criteria

- Saving Grok Imagine in provider settings makes it the default provider for `/creative-video`.
- Env `VIDEO_PROVIDER_KIND=keyframe-image` no longer masks a saved active Grok Imagine selection.
- Explicit `providerKind` requests still work.
- Provider settings visibly distinguishes only the active video config (`使用中`) and inactive configs (`启用`).
- Video Library permits deleting `queued` or `running` items older than 1 hour while continuing to protect newer in-progress items.
- Top navigation remains usable at high zoom: route buttons are horizontally scrollable and collapse to icon-only at the compact-width breakpoint.
- Provider configuration tabs remain readable and usable at high zoom without overlap or clipped labels.
- New video generation jobs record the selected active provider.
- Existing Library jobs remain unchanged and are explained as historical records.
- `pnpm.cmd typecheck` and `pnpm.cmd build` pass.
