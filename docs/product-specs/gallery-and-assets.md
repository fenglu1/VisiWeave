# Gallery And Assets

## Goal

Make generated outputs easy to browse, inspect, locate, download, rerun, and understand across local and optional cloud storage.

## Current Product Shape

- Generated assets are saved locally first.
- Generation records store prompt, effective prompt, mode, preset, size, quality, format, count, status, references, and outputs.
- Gallery lists generated outputs and remains available without credentials.
- Assets expose metadata, preview, download, and raw routes.
- Optional COS upload status is attached to asset metadata.

## Quality Rules

- Local availability is the source of truth. Cloud backup is additional status.
- Gallery cards should preserve the connection between prompt, output, generation record, and asset.
- Downloads should use the stored file and safe filename behavior.
- Asset previews should optimize browsing without breaking access to original generated files.
- Delete behavior should be explicit about what record or output is removed.

## Acceptance Criteria For Changes

- A generated output can be found in Gallery after creation.
- Locate, download, rerun, and delete actions remain clear.
- Failed cloud upload status does not hide the local image.
- Asset path handling stays constrained to `DATA_DIR`.

