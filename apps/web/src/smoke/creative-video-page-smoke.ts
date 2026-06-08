import type { VideoProviderStatus } from "@gpt-image-canvas/shared";
import {
  canSelectVideoMode,
  creativeVideoHeroCopyKeys,
  durationPresetsForProvider,
  nextVideoModeForProviderStatus,
  shouldShowReferencePicker,
  videoProviderStatusUrl
} from "../features/video/CreativeVideoPage";

const grokStatus: VideoProviderStatus = {
  id: "grok-imagine",
  configured: true,
  supportsTextToVideo: true,
  supportsImageToVideo: true,
  durationPresets: [5, 10, 15]
};

const customImageOnlyStatus: VideoProviderStatus = {
  id: "custom-http",
  configured: true,
  supportsTextToVideo: false,
  supportsImageToVideo: true
};

expect(nextVideoModeForProviderStatus(grokStatus, "image_to_video") === "image_to_video", "Grok Imagine keeps supported image-to-video mode");
expect(canSelectVideoMode(grokStatus, "image_to_video") === true, "Grok Imagine image-to-video mode is selectable");
expect(shouldShowReferencePicker(grokStatus, "image_to_video") === true, "supported Grok image-to-video shows reference picker");
expect(JSON.stringify(durationPresetsForProvider(grokStatus)) === JSON.stringify([5, 10, 15]), "Grok Imagine duration choices honor provider presets");
expect(JSON.stringify(durationPresetsForProvider(customImageOnlyStatus)) === JSON.stringify([5, 10, 15, 20, 30]), "providers without duration presets use the shared video defaults");
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
