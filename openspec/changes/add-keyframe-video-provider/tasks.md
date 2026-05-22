# Tasks: Add Keyframe Image Video Provider

## Status Summary

### Completed

- OpenSpec proposal, design, task list, and Creative Video delta specification are drafted.
- Docs/config guidance for `VIDEO_PROVIDER_KIND=keyframe-image`, 4K output settings, duration-based keyframe defaults, FFmpeg verification, and local `.env` secret handling has been updated under the Worker C documentation scope.

### Not Completed

- No implementation code has been changed yet.
- FFmpeg availability has not been verified on the user's machine.
- Real `gpt-image-2` keyframe generation has not been tested through the configured gateway.

### Needs Decisions

- Decide whether the first version keeps temporary keyframes for debugging or deletes them after composition.
- Decide whether image-to-video should fail fast in v1 or attempt a best-effort first-frame/reference workflow.
- Decide whether the UI needs a stronger disclaimer that keyframe video is not native video generation.
- Keep horizontal 4K landscape as the fixed v1 output target unless product explicitly asks to expose resolution settings later.

### Needs Testing

- Test missing FFmpeg and invalid `FFMPEG_PATH`.
- On Windows, verify `ffmpeg -version` for PATH-based installs and `& "<absolute path to ffmpeg.exe>" -version` for explicit `FFMPEG_PATH` installs.
- Test missing OpenAI-compatible image credentials.
- Test gateway image generation with `gpt-image-2`.
- Test native 4K image generation if the gateway supports it.
- Test fallback from highest supported landscape image size to 4K video upscaling.
- Test generated MP4 playback, download, delete, and Gallery exclusion.
- Test Windows paths with spaces and non-ASCII project paths.

## 1. Provider Configuration And Status

- [ ] Add `VIDEO_PROVIDER_KIND=keyframe-image` provider selection.
- [ ] Keep existing custom HTTP provider behavior unchanged when `VIDEO_PROVIDER_KIND` is unset.
- [ ] Add keyframe provider config parsing:
  - `KEYFRAME_VIDEO_FRAME_COUNT`
  - `KEYFRAME_VIDEO_SECONDS`
  - `KEYFRAME_VIDEO_FPS`
  - `KEYFRAME_VIDEO_WIDTH`
  - `KEYFRAME_VIDEO_HEIGHT`
  - `KEYFRAME_VIDEO_INTERPOLATION`
  - `FFMPEG_PATH`
- [ ] Require the OpenAI-compatible image provider env vars when `VIDEO_PROVIDER_KIND=keyframe-image`: `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL`, and `OPENAI_BASE_URL` for non-default gateways.
- [ ] Clamp frame count, seconds, FPS, width, and height to safe bounds.
- [ ] Default keyframe video output to horizontal 4K UHD: `3840x2160` at `24` FPS.
- [ ] Default duration/keyframe mapping when `KEYFRAME_VIDEO_FRAME_COUNT` is unset: `5s=6`, `10s=12`, `20s=24`, `30s=36`.
- [ ] Update provider status so the UI can show `Keyframe Image Video` and capability notes.

## 2. Keyframe Planning

- [ ] Add deterministic keyframe prompt planning for text-to-video.
- [ ] Preserve the user's subject, style, camera language, aspect ratio, and safety constraints across all keyframes.
- [ ] Force v1 keyframe prompts toward landscape `16:9` composition.
- [ ] Add default motion beats such as start, acceleration, side tracking, close-up, pass-by, turn, and ending.
- [ ] Store keyframe plan metadata with the video job for debugging and reproducibility where appropriate.

## 3. Image Generation Adapter

- [ ] Add an internal image generation helper for OpenAI-compatible image APIs.
- [ ] Support `OPENAI_BASE_URL`, `OPENAI_API_KEY`, and `OPENAI_IMAGE_MODEL`.
- [ ] Request native 4K landscape image output when the gateway supports it.
- [ ] Fall back to the highest supported landscape image size when native 4K images are unsupported.
- [ ] Support image responses that return URL, base64, or data URL shapes where the configured gateway provides them.
- [ ] Persist temporary keyframe images in a job-specific runtime work directory.
- [ ] Sanitize upstream image provider errors before saving or displaying them.

## 4. FFmpeg Composition

- [ ] Add FFmpeg discovery and health check using `FFMPEG_PATH` or `ffmpeg` from `PATH`.
- [ ] Document and verify Windows FFmpeg checks: `ffmpeg -version` for PATH installs and quoted explicit paths such as `& "C:\Tools\ffmpeg\bin\ffmpeg.exe" -version`.
- [ ] Add a composition pipeline that normalizes generated frames to `3840x2160` horizontal 4K output.
- [ ] Add MP4 output using H.264-compatible settings suitable for browser playback.
- [ ] Add FFmpeg interpolation using `minterpolate` or a stable fallback when interpolation is unavailable.
- [ ] Validate that output exists, is non-empty, and has a video MIME type.
- [ ] Persist final video asset dimensions as width `3840` and height `2160`.
- [ ] Clean temporary work directories after success or failure unless debug retention is enabled.

## 5. Video Job Integration

- [ ] Wire the keyframe provider into the existing `VideoProvider` interface.
- [ ] Ensure successful outputs reuse existing video asset persistence and Video Library behavior.
- [ ] Ensure failed keyframe jobs appear as failed video records with actionable errors.
- [ ] Ensure generated videos remain excluded from Gallery.
- [ ] Add `providerJobId` or provider metadata that identifies keyframe jobs.

## 6. Web UI Copy

- [ ] Add localized Chinese and English provider status strings for keyframe video.
- [ ] Add a short note in Creative Video explaining that this mode generates image keyframes and composes them into MP4.
- [ ] Ensure provider capability labels distinguish native video providers from keyframe image video.
- [ ] Keep the existing Creative Video form and Video Library layout unchanged unless the status copy requires minor spacing updates.

## 7. Testing And Verification

- [ ] Add unit tests for keyframe config parsing and clamping.
- [ ] Add unit tests for keyframe prompt planning.
- [ ] Add API-level smoke checks for missing FFmpeg and missing image credentials.
- [ ] Add a mocked image provider and mocked FFmpeg smoke path that produces a small MP4 fixture or fake video buffer.
- [ ] Run docs/config hygiene checks to confirm no committed docs contain real API keys, sample secrets, or unfinished marker text.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm build`.
- [ ] Run the app and browser-check Creative Video text-to-video, Video Library playback, download, delete, and Gallery exclusion.
- [ ] If real gateway credentials are available locally, generate one short motorcycle test video and verify it plays in Video Library.
