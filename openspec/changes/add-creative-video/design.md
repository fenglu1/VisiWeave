# Design: Creative Video Generation

## Overview

The feature adds two dedicated top-level workspaces reached from the top navigation:

- `Creative Video`, immediately to the right of `Gallery`.
- `Video Library`, immediately to the right of `Creative Video`.

Creative Video has two modes:

- `Text to Video`: generate an about-10-second video from a prompt.
- `Image to Video`: use a generated local image as the start/reference image and animate it with a motion prompt.

The API should treat video generation as an asynchronous provider job. The web app starts a job, polls status, and updates Video Library when the output is available. Generated videos must not be inserted into Gallery.

## UI Design

### Navigation

The `Creative Video` entry belongs in the same row as the existing app navigation entries. It must sit immediately to the right of `Gallery`; it must not be placed in the Gallery page header.

The `Video Library` entry belongs in the same row and must sit immediately to the right of `Creative Video`.

### Creative Video Workspace

The workspace should use the existing calm workstation visual language: paper surfaces, ink text, copper actions, teal focus, compact controls, and no unrelated hero treatment.

Core controls:

- Mode switch: `Text to Video` and `Image to Video`.
- Prompt textarea.
- Duration preset with default `10s`; providers may map this to supported frames/fps/duration.
- Aspect ratio or size preset, such as `16:9`, `9:16`, and `1:1`.
- Optional motion/style guidance field for image-to-video.
- Provider status row showing configured/missing/running/error states.
- Generate button with disabled/loading states.

Image-to-video can be started from two places:

- Creative Video workspace image picker that lists local generated images.
- Gallery/image detail action such as `Create video`, which opens Creative Video with the selected image preloaded.

### Gallery Behavior

Gallery should remain the image library. It should not list generated videos. Gallery may add a video-related action on an image card or image detail panel, but that action should only preload the selected image into Creative Video for image-to-video generation.

### Video Library Presentation

Video Library is the destination for all generated videos. Video cards should show a poster or first-frame preview, a play icon, duration, prompt excerpt, created time, generation mode, and actions. The detail modal should use a native `<video controls>` player.

## Shared Contracts

Add video contracts under `packages/shared`, for example:

- `VideoGenerationMode = "text_to_video" | "image_to_video"`.
- `VideoGenerationStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled"`.
- `GenerateVideoRequest` with mode, prompt, duration seconds, aspect ratio/size, optional reference asset id, and provider options.
- `VideoGenerationJobResponse` with job id, status, progress message, created time, updated time, output asset, and error.
- `VideoLibraryItem` for generated video records and their local video asset metadata.

The shared contracts are the source of truth for both web and API validation.

## API Design

Add video routes:

- `POST /api/videos/generate`: validates the request, starts a video generation job, and returns the initial job response.
- `GET /api/videos/:jobId`: returns current job status and output metadata if complete.
- `POST /api/videos/:jobId/cancel`: optional first-release cancellation if the provider supports aborting or best-effort cancellation.
- `GET /api/videos` or `GET /api/video-library`: returns generated video library items.
- `DELETE /api/videos/:outputId`: deletes or detaches a generated video output consistently with local asset rules.

Video generation should not block the request for the full provider runtime when the provider is asynchronous. The API should persist a job record first, then update it as provider status changes.

## Provider Design

Introduce a `VideoProvider` interface rather than coupling the feature to one model:

```ts
interface VideoProvider {
  generateTextToVideo(input: TextToVideoProviderInput, signal?: AbortSignal): Promise<VideoProviderJob>;
  generateImageToVideo(input: ImageToVideoProviderInput, signal?: AbortSignal): Promise<VideoProviderJob>;
  poll?(jobId: string, signal?: AbortSignal): Promise<VideoProviderJob>;
  cancel?(jobId: string, signal?: AbortSignal): Promise<void>;
}
```

First implementation should favor a `custom-http` or `comfyui` adapter. This keeps the app lightweight and lets users run open-source video pipelines separately. Later adapters can target LTX-Video, CogVideoX, Wan, Open-Sora, Replicate, or OpenAI-compatible video endpoints if available.

## Persistence Design

Persist videos as local assets under `DATA_DIR/assets`, never outside the configured data directory.

Recommended storage model:

- Extend asset metadata to distinguish `image` and `video`, or add nullable video-specific metadata such as `duration_ms`, `poster_asset_id`, and `media_kind`.
- Add `video_generation_records` and `video_generation_outputs`, or generalize existing generation tables only if migration risk is acceptable.
- Store original prompt, effective prompt, mode, duration, aspect ratio/size, provider id, status, error, reference asset id, output asset id, and timestamps.

The first release should prefer the least risky migration: keep existing image generation behavior stable and add video-specific persistence alongside it.

## Error Handling

The UI must show clear states for:

- Missing video provider configuration.
- Unsupported provider mode, such as image-to-video unavailable.
- Invalid prompt or missing reference image.
- Provider timeout or upstream failure.
- Job failed after starting.
- Video saved locally but cloud backup failed, if cloud backup is enabled later.

Provider errors must be sanitized before returning to the client. Raw API keys, request headers, filesystem paths, and credential-bearing URLs must not be logged or surfaced.

## Security And Privacy

Video files and reference images are private local assets. The API must validate all asset ids, MIME types, file sizes, and file paths before reading or writing. Secret handling must follow the existing provider configuration rules: read APIs return masked secrets only, and saved values are preserved only through explicit preserve flags.

## Verification

Required verification before implementation completion:

- `pnpm typecheck`
- `pnpm build`
- Browser verification with `pnpm dev` at `http://localhost:5173`
- Desktop check for navigation placement, Creative Video workspace, Video Library card, and video detail playback.
- Mobile check for navigation wrapping, form usability, Video Library preview, and video detail layout.
- API checks for missing provider, invalid request, successful job creation, failed provider job, and persisted output retrieval.

## Alternatives Considered

### Direct bundled model runtime

Rejected for the first release. It would pull Python, GPU drivers, model weights, queue management, and platform-specific failures into the Node API process.

### Gallery-only modal

Rejected. The corrected product direction is a top-level Creative Video navigation entry beside Gallery, plus a separate Video Library entry for completed videos.

### External provider only

Useful as an adapter, but not enough as the product model. The app should preserve a provider interface so local open-source services and hosted endpoints can both fit later.
