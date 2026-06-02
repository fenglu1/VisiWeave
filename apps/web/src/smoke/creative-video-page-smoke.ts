import type { VideoProviderStatus } from "@gpt-image-canvas/shared";
import {
  canSelectVideoMode,
  creativeVideoHeroCopyKeys,
  nextVideoModeForProviderStatus,
  shouldShowReferencePicker,
  videoProviderStatusUrl
} from "../features/video/CreativeVideoPage";

const grokStatus: VideoProviderStatus = {
  id: "grok-imagine",
  configured: true,
  supportsTextToVideo: true,
  supportsImageToVideo: false
};

const customImageOnlyStatus: VideoProviderStatus = {
  id: "custom-http",
  configured: true,
  supportsTextToVideo: false,
  supportsImageToVideo: true
};

expect(nextVideoModeForProviderStatus(grokStatus, "image_to_video") === "text_to_video", "Grok Imagine falls back to text-to-video");
expect(canSelectVideoMode(grokStatus, "image_to_video") === false, "Grok Imagine image-to-video mode is not selectable");
expect(shouldShowReferencePicker(grokStatus, "image_to_video") === false, "unsupported image-to-video hides reference picker");
expect(creativeVideoHeroCopyKeys(grokStatus).title === "videoGrokImagineTitle", "Grok Imagine copy is selected from the active provider status");
expect(nextVideoModeForProviderStatus(customImageOnlyStatus, "text_to_video") === "image_to_video", "image-only providers can keep image-to-video available");
expect(shouldShowReferencePicker(customImageOnlyStatus, "image_to_video") === true, "supported image-to-video shows reference picker");
expect(creativeVideoHeroCopyKeys(customImageOnlyStatus).title === "videoCreativeTitle", "non-Grok providers use the generic creative video copy");
expect(videoProviderStatusUrl() === "/api/videos/provider-status", "creative video status lookup follows the saved active provider");

console.log("creative video page smoke checks passed");

function expect(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}
