import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImageSize } from "../../../domain/contracts.js";
import {
  ProviderError,
  createOpenAIImageProvider,
  getOpenAIImageProviderConfig,
  type OpenAIImageProviderConfig,
  type ImageProvider,
  type ProviderResult
} from "../image-provider.js";
import { KeyframeVideoError, sanitizeKeyframeVideoErrorMessage } from "./errors.js";
import type { KeyframePrompt } from "./prompts.js";

interface GenerateKeyframeImagesInput {
  prompts: KeyframePrompt[];
  workDir: string;
  signal?: AbortSignal;
  imageProviderConfig?: OpenAIImageProviderConfig;
  onProgress?: (progress: { completed: number; total: number; prompt: KeyframePrompt }) => void;
}

export interface GeneratedKeyframeImage {
  prompt: KeyframePrompt;
  filePath: string;
}

const LANDSCAPE_FRAME_SIZE: ImageSize = {
  width: 3840,
  height: 2160
};
const FALLBACK_LANDSCAPE_FRAME_SIZE: ImageSize = {
  width: 1920,
  height: 1088
};

export async function createConfiguredKeyframeImageGenerator(
  overrideConfig?: OpenAIImageProviderConfig
): Promise<ImageProvider> {
  if (overrideConfig) {
    return createOpenAIImageProvider(overrideConfig);
  }

  const config = getOpenAIImageProviderConfig();
  if (!config.ok) {
    throw new KeyframeVideoError(
      "video_provider_not_configured",
      "Keyframe video generation requires OPENAI_API_KEY for the image provider.",
      503
    );
  }

  return createOpenAIImageProvider(config.config);
}

export async function generateKeyframeImages(input: GenerateKeyframeImagesInput): Promise<GeneratedKeyframeImage[]> {
  const provider = await createConfiguredKeyframeImageGenerator(input.imageProviderConfig);
  await mkdir(input.workDir, { recursive: true });

  const frames: GeneratedKeyframeImage[] = [];
  for (const prompt of input.prompts) {
    throwIfAborted(input.signal);
    const result = await generateKeyframeImage(provider, prompt, input.signal);
    const providerImage = result.images[0];
    if (!providerImage?.b64Json) {
      throw new KeyframeVideoError(
        "unsupported_provider_behavior",
        "Image provider did not return keyframe image data.",
        502
      );
    }

    const filePath = join(input.workDir, `frame-${String(prompt.index + 1).padStart(3, "0")}.png`);
    await writeFile(filePath, Buffer.from(providerImage.b64Json, "base64"));
    frames.push({
      prompt,
      filePath
    });
    input.onProgress?.({
      completed: frames.length,
      total: input.prompts.length,
      prompt
    });
  }

  return frames;
}

async function generateKeyframeImage(
  provider: ImageProvider,
  prompt: KeyframePrompt,
  signal: AbortSignal | undefined
): Promise<ProviderResult> {
  try {
    return await provider.generate(imageInput(prompt, LANDSCAPE_FRAME_SIZE), signal);
  } catch (error) {
    if (shouldRetryWithFallbackSize(error)) {
      return provider.generate(imageInput(prompt, FALLBACK_LANDSCAPE_FRAME_SIZE), signal);
    }

    throw toVideoProviderError(error);
  }
}

function imageInput(prompt: KeyframePrompt, size: ImageSize) {
  return {
    originalPrompt: prompt.prompt,
    presetId: "keyframe-video",
    prompt: prompt.prompt,
    size,
    sizeApiValue: `${size.width}x${size.height}`,
    quality: "high" as const,
    outputFormat: "png" as const,
    count: 1
  };
}

function shouldRetryWithFallbackSize(error: unknown): boolean {
  if (!(error instanceof ProviderError)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return error.code === "unsupported_provider_behavior" || message.includes("size") || message.includes("resolution");
}

function toVideoProviderError(error: unknown): Error {
  if (error instanceof KeyframeVideoError) {
    return error;
  }

  if (error instanceof ProviderError) {
    return new KeyframeVideoError(
      error.code === "missing_api_key" || error.code === "missing_provider"
        ? "video_provider_not_configured"
        : "upstream_failure",
      sanitizeKeyframeVideoErrorMessage(error.message),
      error.status
    );
  }

  if (error instanceof Error && error.message) {
    return new KeyframeVideoError("upstream_failure", sanitizeKeyframeVideoErrorMessage(error.message), 502);
  }

  return new KeyframeVideoError("upstream_failure", "Image provider failed while generating keyframes.", 502);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new KeyframeVideoError("upstream_failure", "Video generation was cancelled.", 499);
  }
}
