import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { runtimePaths } from "../runtime.js";
import {
  defaultKeyframeFrameCount,
  keyframeVideoConfigFromValues,
  keyframeFrameCountForDuration,
  parseKeyframeVideoConfig,
  type KeyframeVideoConfig
} from "./keyframe-video/config.js";
import { KeyframeVideoError } from "./keyframe-video/errors.js";
import { composeKeyframeVideo } from "./keyframe-video/ffmpeg.js";
import { generateKeyframeImages } from "./keyframe-video/image-frames.js";
import { buildKeyframePrompts } from "./keyframe-video/prompts.js";
import {
  VideoProviderError,
  type VideoProvider,
  type VideoProviderInput,
  type VideoProviderOutput
} from "./video-provider.js";
import type { VideoProviderStatus } from "../../domain/contracts.js";
import type { OpenAIImageProviderConfig } from "./image-provider.js";

export {
  defaultKeyframeFrameCount,
  keyframeVideoConfigFromValues,
  parseKeyframeVideoConfig
} from "./keyframe-video/config.js";
export { buildKeyframePrompts } from "./keyframe-video/prompts.js";

const KEYFRAME_PROVIDER_ID = "keyframe-image";

export function isKeyframeVideoProviderEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VIDEO_PROVIDER_KIND?.trim().toLowerCase() === KEYFRAME_PROVIDER_ID;
}

export function getKeyframeVideoProviderStatus(env: NodeJS.ProcessEnv = process.env): VideoProviderStatus {
  const configured = Boolean(env.OPENAI_API_KEY?.trim());

  return {
    id: KEYFRAME_PROVIDER_ID,
    configured,
    supportsTextToVideo: configured,
    supportsImageToVideo: false,
    message: configured
      ? "Keyframe Image Video provider is configured. It generates image keyframes and composes them into a 4K MP4 with FFmpeg."
      : "Set OPENAI_API_KEY, OPENAI_BASE_URL, and OPENAI_IMAGE_MODEL to enable keyframe image video generation."
  };
}

export function createKeyframeVideoProvider(config: KeyframeVideoConfig = parseKeyframeVideoConfig()): VideoProvider {
  return new KeyframeImageVideoProvider(config);
}

export function createLocalKeyframeVideoProvider(input: {
  videoConfig: {
    apiKey?: string;
    baseUrl?: string;
    width: number;
    height: number;
    fps: number;
    ffmpegPath?: string;
    interpolation?: string;
  };
  imageModel: string;
  imageTimeoutMs: number;
}): VideoProvider {
  const imageProviderConfig = input.videoConfig.apiKey
    ? {
        apiKey: input.videoConfig.apiKey,
        baseURL: input.videoConfig.baseUrl,
        model: input.imageModel,
        timeoutMs: input.imageTimeoutMs
      }
    : undefined;

  return new KeyframeImageVideoProvider(
    keyframeVideoConfigFromValues(input.videoConfig),
    imageProviderConfig
  );
}

class KeyframeImageVideoProvider implements VideoProvider {
  readonly id = KEYFRAME_PROVIDER_ID;

  constructor(
    private readonly config: KeyframeVideoConfig,
    private readonly imageProviderConfig?: OpenAIImageProviderConfig
  ) {}

  async generate(input: VideoProviderInput, signal?: AbortSignal): Promise<VideoProviderOutput> {
    if (input.mode === "image_to_video") {
      throw new VideoProviderError(
        "unsupported_video_mode",
        "The keyframe image video provider currently supports text-to-video only. Reference-based image-to-video needs image provider reference support.",
        400
      );
    }

    const jobId = `keyframe-${randomUUID()}`;
    const workDir = join(runtimePaths.dataDir, "video-work", jobId);
    const frameDir = join(workDir, "frames");
    const outputPath = join(workDir, "output.mp4");

    try {
      input.onProgress?.({
        progressPercent: 4,
        progressStage: "preparing",
        progressMessage: "Preparing keyframe video workspace."
      });
      await mkdir(frameDir, { recursive: true });
      const frameCount = keyframeFrameCountForDuration(this.config, input.durationSeconds);
      const prompts = buildKeyframePrompts({
        prompt: input.prompt,
        durationSeconds: input.durationSeconds,
        frameCount
      });
      input.onProgress?.({
        progressPercent: 8,
        progressStage: "generating_keyframes",
        progressMessage: `Generating 0 of ${prompts.length} keyframes.`
      });
      const frames = await generateKeyframeImages({
        prompts,
        workDir: frameDir,
        signal,
        imageProviderConfig: this.imageProviderConfig,
        onProgress: ({ completed, total }) => {
          const percent = 8 + (completed / Math.max(1, total)) * 72;
          input.onProgress?.({
            progressPercent: percent,
            progressStage: "generating_keyframes",
            progressMessage: `Generated ${completed} of ${total} keyframes.`
          });
        }
      });
      input.onProgress?.({
        progressPercent: 84,
        progressStage: "composing_video",
        progressMessage: "Composing keyframes into a video with FFmpeg."
      });
      await composeKeyframeVideo({
        frames,
        workDir,
        outputPath,
        durationSeconds: input.durationSeconds,
        config: this.config,
        signal
      });
      input.onProgress?.({
        progressPercent: 92,
        progressStage: "saving",
        progressMessage: "Reading composed video file."
      });

      return {
        bytes: await readFile(outputPath),
        mimeType: "video/mp4",
        fileName: `${jobId}.mp4`,
        providerJobId: jobId,
        size: {
          width: this.config.width,
          height: this.config.height
        }
      };
    } catch (error) {
      throw toVideoProviderError(error);
    } finally {
      if (!this.config.keepWorkDir) {
        await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }
}

function toVideoProviderError(error: unknown): Error {
  if (error instanceof VideoProviderError) {
    return error;
  }

  if (error instanceof KeyframeVideoError) {
    return new VideoProviderError(error.code, error.message, error.status);
  }

  if (error instanceof Error && error.message) {
    return new VideoProviderError("upstream_failure", error.message, 502);
  }

  return new VideoProviderError("upstream_failure", "Keyframe video generation failed.", 502);
}
