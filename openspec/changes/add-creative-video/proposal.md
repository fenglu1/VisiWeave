# Change: Add Creative Video Generation

## Summary

Add a `Creative Video` navigation entry next to the existing `Gallery` entry in the top navigation, then add a separate `Video Library` entry immediately to the right of `Creative Video`. The Creative Video workspace supports prompt-to-video and image-to-video workflows, with a default target duration of about 10 seconds. Generated videos are stored locally and appear only in Video Library, not in Gallery.

## Motivation

`gpt-image-canvas` already helps creators generate, arrange, inspect, and reuse AI image assets. Users now need a nearby workflow for turning either a written idea or an existing generated image into a short creative video. The feature should extend the local-first workstation model without forcing the app to bundle a heavy GPU model runtime.

## Goals

- Provide a top-level `Creative Video` entry in the same navigation row as `Gallery`, immediately to the right of `Gallery`.
- Provide a top-level `Video Library` entry in the same navigation row, immediately to the right of `Creative Video`.
- Support text-to-video from a prompt with useful defaults, including an about-10-second duration.
- Support image-to-video from existing generated images in Gallery and canvas workflows.
- Persist generated video files, metadata, prompts, provider status, and failure states locally in a video-specific library.
- Keep Gallery image-only while allowing Gallery images to start image-to-video workflows.
- Keep video provider integration pluggable so the app can use ComfyUI/custom HTTP first and later support open-source model services such as LTX-Video, CogVideoX, Wan, or Open-Sora.
- Preserve creator control by making provider readiness, job progress, errors, and local asset availability visible.

## Non-Goals

- Do not bundle or manage a full Python/GPU video model runtime inside the Node API process for the first release.
- Do not add a full video editor, timeline editor, audio editor, subtitle editor, or multi-shot sequencing workflow.
- Do not add public cloud hosting or sharing links.
- Do not change existing image generation provider behavior.
- Do not include Agent-driven video planning in the first implementation.

## Scope

### In Scope

- Top navigation entry and route for the Creative Video workspace.
- Top navigation entry and route for the Video Library workspace.
- Text-to-video form with prompt, duration, aspect ratio, and provider-aware settings.
- Image-to-video flow that accepts an existing local generated image as a start/reference image.
- API routes and shared contracts for video generation requests, job status, outputs, and video library items.
- SQLite persistence for video generation records and video asset metadata.
- Local storage of generated video assets under the configured data asset directory.
- Video Library presentation for videos, including preview, playback, download, delete, and prompt inspection.
- Gallery image actions that can open Creative Video with a selected image preloaded for image-to-video.
- Provider configuration/status for video generation.
- Desktop and mobile UI behavior.

### Out of Scope

- Advanced video editing.
- Audio generation.
- Batch video generation beyond a single request producing one or more provider-supported outputs.
- Fine-grained model-specific controls that cannot be represented across providers.
- Remote multi-user job queues.

## Affected Areas

- `apps/web`: top navigation, Creative Video workspace, Video Library workspace, Gallery image-to-video entry points, i18n, responsive styles.
- `apps/api`: video routes, provider adapter selection, async job orchestration, local asset persistence, video library retrieval.
- `packages/shared`: video request/response contracts, job status types, video library item types, validation constants.
- SQLite runtime data: new or extended tables for video generation records, outputs, job status, duration, and optional poster metadata.

## References

- ComfyUI can serve as a local workflow host and API integration point for open-source video pipelines.
- LTX-Video and CogVideoX are candidate open-source model-service references for text-to-video and image-to-video behavior.
