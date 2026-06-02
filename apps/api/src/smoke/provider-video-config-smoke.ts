import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const dataDir = resolve(process.cwd(), ".codex-temp", `provider-video-config-smoke-${randomUUID()}`);
process.env.DATA_DIR = dataDir;

const { closeDatabase } = await import("../infrastructure/database.js");
const { getProviderConfig, saveProviderConfig } = await import("../domain/providers/provider-config.js");
const { getConfiguredVideoProvider, getVideoProviderStatus } = await import("../infrastructure/providers/video-provider.js");

async function main(): Promise<void> {
  delete process.env.VIDEO_PROVIDER_KIND;
  delete process.env.VIDEO_PROVIDER_URL;
  delete process.env.VIDEO_PROVIDER_TEXT_TO_VIDEO_URL;
  delete process.env.VIDEO_PROVIDER_IMAGE_TO_VIDEO_URL;
  delete process.env.VIDEO_PROVIDER_STATUS_URL;
  delete process.env.VIDEO_PROVIDER_API_KEY;
  delete process.env.VIDEO_PROVIDER_MODEL;

  process.env.VIDEO_PROVIDER_KIND = "grok-imagine";
  process.env.VIDEO_PROVIDER_API_KEY = "test-env-video-config-key";
  delete process.env.VIDEO_PROVIDER_URL;
  const missingGrokUrlStatus = getVideoProviderStatus();
  expect(missingGrokUrlStatus.id === "grok-imagine", "environment Grok status keeps the selected provider kind");
  expect(missingGrokUrlStatus.configured === false, "environment Grok without an explicit base URL is not configured");
  const missingGrokUrlProvider = getConfiguredVideoProvider();
  expect(missingGrokUrlProvider.ok === false, "environment Grok without an explicit base URL does not create a provider");
  expect(!JSON.stringify(missingGrokUrlProvider).includes("test-env-video-config-key"), "unconfigured environment Grok error does not expose the API key");

  process.env.VIDEO_PROVIDER_URL = "https://video-provider.example.com/v1";
  const imageOnlySaved = saveProviderConfig({
    sourceOrder: ["local-openai", "env-openai", "codex"],
    localOpenAI: {
      apiKey: "test-image-only-key",
      baseUrl: "https://images-only.example.test/v1"
    }
  });

  expect(imageOnlySaved.video.kind === "grok-imagine", "image-only save keeps environment video provider fallback active");
  expect(imageOnlySaved.video.source === "environment", "image-only save does not create a local video config");
  expect(!JSON.stringify(imageOnlySaved).includes("test-env-video-config-key"), "environment video API key is never exposed");

  process.env.VIDEO_PROVIDER_KIND = "keyframe-image";
  process.env.OPENAI_API_KEY = "test-env-openai-key";
  delete process.env.VIDEO_PROVIDER_API_KEY;
  const unconfiguredGrokActive = saveProviderConfig({
    sourceOrder: ["local-openai", "env-openai", "codex"],
    video: {
      kind: "grok-imagine",
      apiKey: "",
      preserveApiKey: false,
      baseUrl: "https://video-provider.example.com/v1",
      videoModel: "grok-imagine-video"
    }
  });
  expect(unconfiguredGrokActive.video.kind === "grok-imagine", "unconfigured saved Grok remains the active video provider");
  expect(unconfiguredGrokActive.video.configured === false, "unconfigured saved Grok is reported as missing configuration");
  expect(unconfiguredGrokActive.video.source === "local", "unconfigured saved Grok is still a local active selection");
  const unconfiguredGrokStatus = getVideoProviderStatus();
  expect(unconfiguredGrokStatus.id === "grok-imagine", "unconfigured saved Grok status does not fall back to env keyframe");
  expect(unconfiguredGrokStatus.configured === false, "unconfigured saved Grok status is not configured");
  const unconfiguredGrokProvider = getConfiguredVideoProvider();
  expect(unconfiguredGrokProvider.ok === false, "unconfigured saved Grok does not create a configured provider");
  expect(unconfiguredGrokProvider.status.id === "grok-imagine", "unconfigured saved Grok provider error keeps the active provider id");

  delete process.env.VIDEO_PROVIDER_KIND;
  delete process.env.VIDEO_PROVIDER_API_KEY;
  delete process.env.OPENAI_API_KEY;

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

  const grokSaved = saveProviderConfig({
    sourceOrder: ["local-openai", "env-openai", "codex"],
    video: {
      kind: "grok-imagine",
      apiKey: "test-grok-config-key",
      baseUrl: " https://video-provider.example.com/v1 ",
      videoModel: " grok-imagine-video "
    }
  });

  expect(grokSaved.video.kind === "grok-imagine", "grok imagine video kind is returned");
  expect(grokSaved.video.baseUrl === "https://video-provider.example.com/v1", "grok imagine base URL is trimmed");
  expect(grokSaved.video.videoModel === "grok-imagine-video", "grok imagine video model is trimmed and returned");
  expect(grokSaved.video.apiKey.hasSecret === true, "grok imagine API key is masked");
  expect(!JSON.stringify(grokSaved).includes("test-grok-config-key"), "grok imagine API key is never exposed");
  expect(grokSaved.videoConfigs["custom-http"].baseUrl === "https://video-2.example.test/v1/generate", "saving grok keeps custom HTTP base URL");
  expect(grokSaved.videoConfigs["custom-http"].apiKey.hasSecret === true, "saving grok keeps custom HTTP API key");

  const grokPreserved = saveProviderConfig({
    sourceOrder: ["local-openai", "env-openai", "codex"],
    video: {
      kind: "grok-imagine",
      apiKey: "",
      preserveApiKey: true,
      videoModel: "grok-2-image-1212"
    }
  });

  expect(grokPreserved.video.apiKey.hasSecret === true, "preserving grok imagine key keeps the saved secret");
  expect(grokPreserved.video.videoModel === "grok-2-image-1212", "grok imagine model can update without retyping the key");

  const keyframeSaved = saveProviderConfig({
    sourceOrder: ["local-openai", "env-openai", "codex"],
    video: {
      kind: "keyframe-image",
      apiKey: "test-keyframe-video-key",
      baseUrl: " https://images.example.test/v1 ",
      ffmpegPath: " ffmpeg ",
      width: 3840,
      height: 2160,
      fps: 24,
      interpolation: "ffmpeg"
    }
  });

  expect(keyframeSaved.video.kind === "keyframe-image", "keyframe video kind is returned");
  expect(keyframeSaved.videoConfigs["grok-imagine"].videoModel === "grok-2-image-1212", "saving keyframe keeps grok model");
  expect(keyframeSaved.videoConfigs["grok-imagine"].apiKey.hasSecret === true, "saving keyframe keeps grok API key");
  expect(keyframeSaved.videoConfigs["custom-http"].baseUrl === "https://video-2.example.test/v1/generate", "saving keyframe keeps custom HTTP base URL");

  console.log("provider video config smoke checks passed");
}

function expect(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  await main();
} finally {
  closeDatabase();
  await rm(dataDir, { recursive: true, force: true });
}
