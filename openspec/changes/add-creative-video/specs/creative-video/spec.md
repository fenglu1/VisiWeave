# Creative Video Delta Specification

## ADDED Requirements

### Requirement: Creative Video And Video Library Navigation Entries

The application SHALL expose `Creative Video` and `Video Library` navigation entries in the same top navigation row as `Gallery`.

#### Scenario: Open Creative Video from navigation

- **GIVEN** the top navigation is visible
- **WHEN** the user selects `Creative Video`
- **THEN** the application SHALL show the Creative Video workspace
- **AND** the `Creative Video` entry SHALL be positioned immediately to the right of `Gallery`
- **AND** the `Creative Video` entry SHALL NOT be placed inside the Gallery page header

#### Scenario: Open Video Library from navigation

- **GIVEN** the top navigation is visible
- **WHEN** the user selects `Video Library`
- **THEN** the application SHALL show the Video Library workspace
- **AND** the `Video Library` entry SHALL be positioned immediately to the right of `Creative Video`

#### Scenario: Preserve Gallery navigation

- **GIVEN** the user can navigate to Gallery
- **WHEN** the Creative Video and Video Library entries are added
- **THEN** the existing Gallery entry SHALL remain available
- **AND** Gallery behavior SHALL continue to load existing image history only

### Requirement: Text To Video Generation

The Creative Video workspace SHALL allow users to generate a short video from a prompt without requiring a reference image.

#### Scenario: Submit text-to-video request

- **GIVEN** a video provider is configured and supports text-to-video
- **AND** the user is in `Text to Video` mode
- **AND** the user enters a valid prompt
- **WHEN** the user starts generation
- **THEN** the application SHALL create a video generation job
- **AND** the request SHALL include the prompt, mode, duration, and aspect ratio or size
- **AND** the default duration SHALL target about 10 seconds unless the user changes it

#### Scenario: Prompt is missing

- **GIVEN** the user is in `Text to Video` mode
- **WHEN** the user starts generation without a prompt
- **THEN** the application SHALL reject the request before provider execution
- **AND** the UI SHALL explain that a prompt is required

### Requirement: Image To Video Generation

The Creative Video workspace SHALL allow users to generate a short video from an existing generated image and a motion prompt.

#### Scenario: Start image-to-video from Gallery image

- **GIVEN** a Gallery image has a local asset id
- **WHEN** the user chooses the image-to-video action for that image
- **THEN** the application SHALL open the Creative Video workspace in `Image to Video` mode
- **AND** the selected image SHALL be preloaded as the reference image

#### Scenario: Submit image-to-video request

- **GIVEN** a video provider is configured and supports image-to-video
- **AND** the user is in `Image to Video` mode
- **AND** a valid generated image is selected
- **AND** the user enters a valid motion prompt
- **WHEN** the user starts generation
- **THEN** the application SHALL create a video generation job
- **AND** the request SHALL include the prompt, mode, duration, aspect ratio or size, and reference asset id
- **AND** the default duration SHALL target about 10 seconds unless the user changes it

#### Scenario: Reference image is missing

- **GIVEN** the user is in `Image to Video` mode
- **WHEN** the user starts generation without selecting a reference image
- **THEN** the application SHALL reject the request before provider execution
- **AND** the UI SHALL explain that a generated image is required

### Requirement: Video Provider Readiness

The application SHALL make video provider readiness visible before and during generation.

#### Scenario: Provider is missing

- **GIVEN** no video provider is configured
- **WHEN** the user opens the Creative Video workspace
- **THEN** the workspace SHALL show that video generation is not configured
- **AND** generation actions SHALL be disabled or redirect the user to provider configuration

#### Scenario: Provider does not support selected mode

- **GIVEN** a video provider is configured
- **AND** the provider supports text-to-video but not image-to-video
- **WHEN** the user selects `Image to Video`
- **THEN** the UI SHALL show that the selected mode is unavailable
- **AND** the API SHALL reject image-to-video requests with a stable error code

### Requirement: Asynchronous Video Jobs

The application SHALL represent video generation as an inspectable asynchronous job.

#### Scenario: Job status is visible

- **GIVEN** a user starts a video generation job
- **WHEN** the provider accepts the request
- **THEN** the UI SHALL show the job as queued or running
- **AND** the UI SHALL poll or subscribe to status updates until the job succeeds, fails, or is cancelled

#### Scenario: Job succeeds

- **GIVEN** a video generation job is running
- **WHEN** the provider returns a valid video output
- **THEN** the API SHALL save the video as a local asset
- **AND** the job SHALL transition to `succeeded`
- **AND** the resulting video SHALL become visible in Video Library
- **AND** the resulting video SHALL NOT be inserted into Gallery

#### Scenario: Job fails

- **GIVEN** a video generation job is running
- **WHEN** the provider fails or times out
- **THEN** the job SHALL transition to `failed`
- **AND** the UI SHALL show a sanitized, actionable error message
- **AND** the failed job SHALL remain inspectable

### Requirement: Local Video Asset Persistence

Generated videos SHALL be persisted locally with enough metadata to preview, download, delete, and inspect them later from Video Library.

#### Scenario: Save generated video asset

- **GIVEN** a provider returns a video file or downloadable video URL
- **WHEN** the API stores the result
- **THEN** the video file SHALL be written under the configured local assets directory
- **AND** the database SHALL store the asset id, file name, MIME type, dimensions when available, duration when available, prompt, mode, provider, status, and timestamps

#### Scenario: Asset path is invalid

- **GIVEN** an asset id resolves outside the configured assets directory
- **WHEN** the API attempts to read or serve the asset
- **THEN** the API SHALL reject the request
- **AND** it SHALL NOT expose filesystem paths in the response

### Requirement: Video Library Support

Video Library SHALL store and present generated videos without regressing Gallery image behavior.

#### Scenario: Show video item in Video Library

- **GIVEN** a video generation job has succeeded
- **WHEN** the user opens Video Library
- **THEN** the video SHALL appear as a media item
- **AND** the card SHALL show a video preview or poster, duration when available, prompt excerpt, created time, and video-specific affordance

#### Scenario: Open video detail

- **GIVEN** a video item is visible in Video Library
- **WHEN** the user opens the item
- **THEN** the detail view SHALL play the video with native controls
- **AND** the user SHALL be able to inspect the prompt and generation metadata

#### Scenario: Video is absent from Gallery

- **GIVEN** a video generation job has succeeded
- **WHEN** the user opens Gallery
- **THEN** the video SHALL NOT appear in Gallery
- **AND** Gallery SHALL continue to show image outputs only

#### Scenario: Existing image behavior remains stable

- **GIVEN** Gallery contains existing image outputs
- **WHEN** Creative Video and Video Library are added
- **THEN** existing image preview, detail, prompt copy, download, reuse, and delete behavior SHALL continue to work

### Requirement: Video Actions

The application SHALL provide core actions for generated videos.

#### Scenario: Download video

- **GIVEN** a generated video is available locally
- **WHEN** the user chooses download
- **THEN** the browser SHALL download or open the original video asset

#### Scenario: Delete video

- **GIVEN** a generated video exists in Video Library
- **WHEN** the user confirms deletion
- **THEN** the application SHALL remove or detach the video output consistently with local asset rules
- **AND** the deleted item SHALL no longer appear in Video Library

#### Scenario: Copy video prompt

- **GIVEN** a generated video has a prompt
- **WHEN** the user chooses copy prompt
- **THEN** the prompt SHALL be copied to the clipboard
- **AND** the UI SHALL show success or failure feedback

### Requirement: Secure Video Handling

The application SHALL validate and sanitize video inputs, outputs, and provider errors.

#### Scenario: Provider error contains sensitive data

- **GIVEN** a provider error includes credentials, headers, raw request details, or credential-bearing URLs
- **WHEN** the API returns the error to the client
- **THEN** the response SHALL omit or redact sensitive values
- **AND** logs SHALL NOT include raw secrets

#### Scenario: Unsupported video content type

- **GIVEN** a provider returns an unsupported content type
- **WHEN** the API validates the output
- **THEN** the job SHALL fail with a stable unsupported-provider-behavior error
- **AND** the invalid file SHALL NOT be persisted as a valid video library item

### Requirement: Responsive And Accessible UI

Creative Video and Video Library UI SHALL be usable on desktop and mobile and accessible by keyboard.

#### Scenario: Desktop layout

- **GIVEN** the user opens the app on a desktop viewport
- **WHEN** they navigate between Gallery, Creative Video, and Video Library
- **THEN** the navigation row SHALL remain readable
- **AND** the Creative Video form and job status SHALL not overlap or obscure essential controls

#### Scenario: Mobile layout

- **GIVEN** the user opens the app on a mobile viewport
- **WHEN** they use Creative Video or inspect Video Library media
- **THEN** controls SHALL wrap or stack without horizontal scrolling
- **AND** video preview and playback SHALL remain usable

#### Scenario: Keyboard access

- **GIVEN** the user navigates with a keyboard
- **WHEN** they focus Creative Video controls, mode switches, media cards, and modal actions
- **THEN** focus SHALL be visible
- **AND** all primary actions SHALL be reachable without a pointer
