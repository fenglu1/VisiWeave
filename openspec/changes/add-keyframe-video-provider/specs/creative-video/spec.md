# Creative Video Delta Specification: Keyframe Image Provider

## ADDED Requirements

### Requirement: Keyframe Image Video Provider

The system SHALL support an internal keyframe-based video provider that generates landscape still image keyframes with an OpenAI-compatible image model and composes them into a playable horizontal 4K MP4 with FFmpeg.

#### Scenario: Enable keyframe image provider

- **GIVEN** `VIDEO_PROVIDER_KIND` is set to `keyframe-image`
- **AND** an OpenAI-compatible image provider is configured with `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_IMAGE_MODEL`
- **AND** FFmpeg is available through `FFMPEG_PATH` or `PATH`
- **WHEN** the user opens Creative Video
- **THEN** the provider status SHALL show video generation as configured
- **AND** the provider status SHALL identify that this is a keyframe image video provider
- **AND** the user SHALL be able to submit a text-to-video job

#### Scenario: Generate text-to-video from image keyframes

- **GIVEN** the keyframe image provider is configured
- **WHEN** the user submits a text-to-video request with a prompt, duration, and aspect ratio
- **THEN** the API SHALL create multiple related keyframe image prompts from the user's prompt
- **AND** the API SHALL generate a bounded number of keyframe images using the configured image model
- **AND** the generated keyframes SHALL target a landscape `16:9` composition
- **AND** the API SHALL invoke FFmpeg to compose those keyframes into a video file
- **AND** the output video SHALL be horizontal 4K UHD with dimensions `3840x2160`
- **AND** the output video SHALL use `24` FPS by default
- **AND** the output SHALL be stored as a video asset
- **AND** the generated output SHALL appear in Video Library
- **AND** the generated output SHALL NOT appear in Gallery

#### Scenario: Resolve default keyframe count from duration

- **GIVEN** the keyframe image provider is configured
- **AND** `KEYFRAME_VIDEO_FRAME_COUNT` is unset
- **WHEN** the user submits a text-to-video request for `5`, `10`, `20`, or `30` seconds
- **THEN** the provider SHALL generate `6`, `12`, `24`, or `36` keyframes respectively
- **AND** the final video SHALL keep horizontal 4K dimensions `3840x2160`
- **AND** the final video SHALL use the configured frame rate, defaulting to `24` FPS

#### Scenario: Compose an interpolated MP4

- **GIVEN** keyframe images have been generated successfully
- **WHEN** FFmpeg composition runs
- **THEN** the system SHALL normalize frames to landscape `16:9`
- **AND** the system SHALL scale and crop frames to `3840x2160`
- **AND** the system SHALL output an MP4 video at the configured target frame rate
- **AND** the system SHALL use FFmpeg interpolation or equivalent built-in frame synthesis when `KEYFRAME_VIDEO_INTERPOLATION=ffmpeg`
- **AND** the system SHALL persist MIME type, duration, dimensions, provider id, prompt, status, and asset metadata

#### Scenario: Image gateway cannot return native 4K frames

- **GIVEN** the keyframe image provider is configured for 4K output
- **AND** the configured image gateway cannot return native `3840x2160` images
- **WHEN** the user submits a text-to-video request
- **THEN** the provider SHALL request the highest supported landscape image size
- **AND** FFmpeg SHALL upscale and crop those frames to `3840x2160`
- **AND** the final saved video asset SHALL still report dimensions `3840x2160`

#### Scenario: Missing FFmpeg

- **GIVEN** the keyframe image provider is enabled
- **AND** FFmpeg cannot be found or cannot run
- **WHEN** the user submits a video generation job
- **THEN** the job SHALL fail with an actionable error explaining that FFmpeg must be installed or configured
- **AND** the error SHALL be visible in the Creative Video job status or Video Library failed job record
- **AND** the error SHALL NOT expose local secrets

#### Scenario: Missing image provider credentials

- **GIVEN** the keyframe image provider is enabled
- **AND** the OpenAI-compatible image provider credentials are missing
- **WHEN** the user opens Creative Video or submits a video generation job
- **THEN** the provider status or job error SHALL explain that image provider credentials are required
- **AND** the system SHALL NOT attempt FFmpeg composition

#### Scenario: Local configuration does not leak secrets

- **GIVEN** the user enables `VIDEO_PROVIDER_KIND=keyframe-image` with `.env`
- **WHEN** docs, examples, OpenSpec files, logs, or generated assets are committed
- **THEN** they SHALL NOT contain real `OPENAI_API_KEY` values, bearer tokens, or provider secret material
- **AND** committed examples SHALL use blank values or clearly fake sample values only

#### Scenario: Image-to-video with unsupported image references

- **GIVEN** the keyframe image provider is enabled
- **AND** the configured image provider does not support using the selected image as a generation reference
- **WHEN** the user submits an image-to-video job
- **THEN** the system SHALL fail the job with an actionable unsupported-mode message
- **AND** the message SHALL explain that text-to-keyframe video is available while reference-based image-to-video needs provider support

### Requirement: Keyframe Provider Configuration Safety

The system SHALL keep provider credentials and runtime keyframe artifacts local and out of committed project files.

#### Scenario: Runtime assets stay local

- **GIVEN** a keyframe video job runs
- **WHEN** temporary keyframe images and FFmpeg intermediate files are created
- **THEN** they SHALL be stored under ignored runtime data directories
- **AND** the final video SHALL be stored under existing local asset storage
- **AND** no provider key, bearer token, or committed OpenSpec file SHALL contain real secrets

#### Scenario: Error sanitization

- **GIVEN** an upstream image provider or FFmpeg command returns an error
- **WHEN** the error is persisted or displayed
- **THEN** bearer tokens, API keys, local absolute paths, and secret query parameters SHALL be redacted
