import { getProviderConfig, saveProviderConfig } from "../domain/providers/provider-config.js";
import { getConfiguredVideoProvider, getVideoProviderStatus } from "../infrastructure/providers/video-provider.js";

function main(): void {
  delete process.env.VIDEO_PROVIDER_KIND;
  delete process.env.VIDEO_PROVIDER_URL;
  delete process.env.VIDEO_PROVIDER_TEXT_TO_VIDEO_URL;
  delete process.env.VIDEO_PROVIDER_IMAGE_TO_VIDEO_URL;
  delete process.env.VIDEO_PROVIDER_STATUS_URL;
  delete process.env.VIDEO_PROVIDER_API_KEY;

  const saved = saveProviderConfig({
    sourceOrder: ["local-openai", "env-openai", "codex"],
    video: {
      kind: "custom-http",
      apiKey: "test-video-config-key",
      baseUrl: " https://video.example.test/v1/generate ",
      textToVideoUrl: " https://video.example.test/v1/text ",
      imageToVideoUrl: " https://video.example.test/v1/image ",
      timeoutMs: 12345,
      pollIntervalMs: 3456
    }
  });

  expect(saved.video.kind === "custom-http", "saved video kind is returned");
  expect(saved.video.baseUrl === "https://video.example.test/v1/generate", "base URL is trimmed");
  expect(saved.video.textToVideoUrl === "https://video.example.test/v1/text", "text-to-video URL is trimmed");
  expect(saved.video.imageToVideoUrl === "https://video.example.test/v1/image", "image-to-video URL is trimmed");
  expect(saved.video.apiKey.hasSecret === true, "saved video API key is masked");
  expect(!JSON.stringify(saved).includes("test-video-config-key"), "saved video API key is never exposed");

  const preserved = saveProviderConfig({
    sourceOrder: ["local-openai", "env-openai", "codex"],
    video: {
      kind: "custom-http",
      apiKey: "",
      preserveApiKey: true,
      baseUrl: "https://video-2.example.test/v1/generate",
      timeoutMs: 23456,
      pollIntervalMs: 4567
    }
  });

  expect(preserved.video.apiKey.hasSecret === true, "preserving video key keeps the saved secret");
  expect(preserved.video.baseUrl === "https://video-2.example.test/v1/generate", "video config can update without retyping the key");

  const status = getVideoProviderStatus();
  expect(status.configured === true, "local video config enables the video provider");
  expect(status.supportsTextToVideo === true, "local video config supports text-to-video");
  expect(status.supportsImageToVideo === true, "local video config supports image-to-video");

  const provider = getConfiguredVideoProvider();
  expect(provider.ok === true, "local video config creates a configured provider");
  if (provider.ok) {
    expect(provider.provider.id === "custom-http", "configured provider uses the custom HTTP provider");
  }

  const readback = getProviderConfig();
  expect(readback.video.timeoutMs === 23456, "readback includes updated timeout");
  expect(readback.video.pollIntervalMs === 4567, "readback includes updated poll interval");

  console.log("provider video config smoke checks passed");
}

function expect(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

main();
