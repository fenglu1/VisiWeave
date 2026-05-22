# Change: Add Keyframe Image Video Provider

## Summary

Add an internal `keyframe-image` video provider that can create a short MP4 video when only an OpenAI-compatible image model such as `gpt-image-2` is available. The provider generates a small set of visual keyframes from the user's video prompt, then uses local FFmpeg processing to compose and interpolate those frames into a playable video saved in the existing Video Library.

## Problem

The current Creative Video feature expects an external video provider endpoint. Some available API gateways expose `gpt-image-2` but do not expose a native video model or `/v1/videos` endpoint. Users still need a visible video result from the Creative Video workflow without installing ComfyUI, Wan, LTX-Video, RIFE, Python, CUDA, or a separate model service.

## Goals

- Provide a local-first fallback provider for short landscape 4K videos using `gpt-image-2` keyframes.
- Keep the existing Creative Video and Video Library user flow unchanged.
- Support text-to-video first; support image-to-video by using the selected reference image as visual guidance where the image API supports references.
- Use FFmpeg to create a real horizontal 4K MP4 file at `3840x2160` and `24` FPS, then apply built-in interpolation/transition effects.
- Support the Creative Video duration presets `5`, `10`, `20`, and `30` seconds with default keyframe counts of `6`, `12`, `24`, and `36`.
- Target 4K landscape keyframes; when the image API cannot return native `3840x2160` images, generate the highest supported landscape image size and upscale/crop frames to `3840x2160` before video composition.
- Make missing FFmpeg, missing image provider credentials, image generation failures, and video composition failures visible with actionable errors.
- Avoid storing provider secrets in generated assets, logs, OpenSpec docs, or committed files.

## Non-Goals

- This change does not add a native diffusion video model such as Sora, Wan, LTX-Video, Kling, or Runway.
- This change does not add heavy AI interpolation such as RIFE or Flowframes in the first version.
- This change does not guarantee perfect subject consistency between keyframes.
- This change does not place generated videos in Gallery; videos remain in Video Library only.

## User Value

Users can click Creative Video and get a visible `5`, `10`, `20`, or `30` second horizontal 4K MP4 result using the image provider they already have. The result will be closer to a cinematic animated storyboard than native video, but it gives an immediate end-to-end workflow and a usable preview path before adding heavier video infrastructure.

## Affected Areas

- `apps/api`: provider selection, keyframe generation, FFmpeg composition, asset persistence, error handling.
- `apps/web`: provider status copy and optional disclosure that this mode is keyframe-based.
- `packages/shared`: provider status metadata if the UI needs to distinguish native video from keyframe video.
- `openspec`: Creative Video requirements and task tracking.
