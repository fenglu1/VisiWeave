# Design: Keyframe Image Video Provider

## Overview

The provider adds a new internal video generation path named `keyframe-image`. It uses the existing OpenAI-compatible image configuration to generate sequential keyframes, then invokes FFmpeg to compose those still images into an MP4 video. FFmpeg's built-in filters provide frame interpolation and subtle motion so users can see a video-like result without a native video model.

## Configuration

The provider is enabled by environment variables:

```env
VIDEO_PROVIDER_KIND=keyframe-image
OPENAI_BASE_URL=https://example-provider.test/v1
OPENAI_API_KEY=
OPENAI_IMAGE_MODEL=gpt-image-2
KEYFRAME_VIDEO_FRAME_COUNT=
KEYFRAME_VIDEO_SECONDS=10
KEYFRAME_VIDEO_WIDTH=3840
KEYFRAME_VIDEO_HEIGHT=2160
KEYFRAME_VIDEO_FPS=24
KEYFRAME_VIDEO_INTERPOLATION=ffmpeg
FFMPEG_PATH=ffmpeg
```

`OPENAI_API_KEY` must never be committed. These values belong in local `.env` or the runtime environment only; OpenSpec docs and committed examples must not contain real provider keys.

`VIDEO_PROVIDER_KIND=keyframe-image` requires the OpenAI-compatible image provider variables `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL`, and `OPENAI_BASE_URL` when the user is not using the default OpenAI endpoint. `FFMPEG_PATH` defaults to `ffmpeg`, which means the binary must be available on `PATH`. On Windows, operators can verify the PATH case with `ffmpeg -version` or verify an explicit executable with a PowerShell command such as `& "C:\Tools\ffmpeg\bin\ffmpeg.exe" -version`.

The first version targets horizontal 4K output with:

- `KEYFRAME_VIDEO_WIDTH=3840`
- `KEYFRAME_VIDEO_HEIGHT=2160`
- `KEYFRAME_VIDEO_FPS=24`

When `KEYFRAME_VIDEO_FRAME_COUNT` is unset, the provider uses duration-based defaults:

- `5` seconds: `6` keyframes
- `10` seconds: `12` keyframes
- `20` seconds: `24` keyframes
- `30` seconds: `36` keyframes

## Provider Selection

`apps/api/src/infrastructure/providers/video-provider.ts` currently selects a custom HTTP provider from `VIDEO_PROVIDER_URL`, `VIDEO_PROVIDER_TEXT_TO_VIDEO_URL`, or `VIDEO_PROVIDER_IMAGE_TO_VIDEO_URL`.

This change adds provider selection order:

1. If `VIDEO_PROVIDER_KIND=keyframe-image`, use the internal keyframe provider.
2. Otherwise, keep the existing custom HTTP provider behavior.

This keeps existing users stable and makes the fallback opt-in.

## Keyframe Planning

For each request, the API builds a deterministic keyframe plan from the user prompt:

- Target duration comes from the request's `durationSeconds` and is expected to use the Creative Video presets `5`, `10`, `20`, or `30` seconds in v1.
- Output orientation is landscape-only in v1, targeting `16:9`.
- Output dimensions default to 4K UHD: `3840x2160` at `24` FPS.
- Frame count uses `KEYFRAME_VIDEO_FRAME_COUNT` only when explicitly set; otherwise it defaults by duration to `6`, `12`, `24`, or `36` keyframes for `5`, `10`, `20`, or `30` seconds respectively. The resolved count is clamped to a safe range.
- Each keyframe prompt keeps the same subject, style, camera language, aspect ratio, and safety constraints.
- Each keyframe adds one motion beat such as start, acceleration, turn, close-up, pass-by, or ending.

The first version may generate this plan with deterministic templates instead of an additional LLM call. This keeps costs lower and avoids requiring a separate chat model.

## Image Generation

The provider calls the existing OpenAI-compatible image generation capability using `OPENAI_BASE_URL`, `OPENAI_API_KEY`, and `OPENAI_IMAGE_MODEL`.

For text-to-video:

- Generate `N` landscape keyframes from `N` related prompts.
- Request native 4K landscape image output when the configured image gateway supports it.
- If native 4K image output is unsupported, request the highest supported landscape size and let FFmpeg upscale/crop to `3840x2160`.
- Store temporary frames under ignored runtime data, not committed project files.

For image-to-video:

- If the current image provider supports image references/editing, use the selected generated image as the first-frame/reference input.
- If image reference generation is not supported by the configured gateway, return an actionable `unsupported_video_mode` style error explaining that this provider currently supports text-to-keyframe video only.

## FFmpeg Composition

The provider writes frames to a job-specific working directory under `DATA_DIR/video-work/<jobId>`.

Composition has two phases:

1. Normalize still images to the requested output size and create a low-frame-rate input sequence.
2. Apply FFmpeg filters to produce MP4 output:
   - `scale` and `crop` for consistent 4K landscape dimensions.
   - `fps` or `minterpolate` for the target frame rate.
   - Optional zoom/pan or fade transitions if they are stable across platforms.

The output MP4 is copied into the existing video asset storage path and registered as a normal video output with width `3840` and height `2160`. Temporary frame directories can be kept for debugging only when a development flag is enabled; otherwise they are cleaned after success or failure.

## Error Handling

The provider returns clear errors for:

- Missing `OPENAI_API_KEY`.
- Missing or invalid `OPENAI_BASE_URL`.
- Missing `ffmpeg` binary or failed `ffmpeg -version`.
- Image provider request failure.
- Empty image response or unsupported image response shape.
- Image gateway not supporting requested native 4K output; this should fall back to supported landscape generation plus FFmpeg upscaling when possible.
- FFmpeg exit failure.
- Output file missing, empty, or not recognized as video.

Provider errors must be sanitized before persistence and UI display. They must not include API keys, bearer tokens, local full paths, or query-string secrets.

## UI Behavior

Creative Video can keep the same form. Provider status should indicate when the active provider is `keyframe-image`, for example:

- Provider: `Keyframe Image Video`
- Mode note: `Generates image keyframes and composes them into MP4 with FFmpeg interpolation.`

Video Library behavior does not change. The generated MP4 appears only in Video Library and can be played, downloaded, copied, or deleted.

## Security And Privacy

- Secrets stay in `.env` or runtime environment only.
- Generated keyframes and MP4 outputs are local assets under `DATA_DIR`.
- API logs must not print prompts together with secrets or upstream authorization headers.
- Runtime work directories are ignored and must not be committed.

## Verification

- `pnpm typecheck`
- `pnpm build`
- API smoke test for missing FFmpeg.
- API smoke test for missing image credentials.
- API smoke test with a mocked image provider and mocked FFmpeg command.
- Manual browser test of Creative Video text-to-video and Video Library playback.
