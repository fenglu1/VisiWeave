import type {
  GenerateVideoRequest,
  VideoGenerationMode,
  VideoGenerationProgressStage,
  VideoProviderStatus
} from "../../domain/contracts.js";
import {
  createKeyframeVideoProvider,
  createLocalKeyframeVideoProvider,
  getKeyframeVideoProviderStatus,
  isKeyframeVideoProviderEnabled
} from "./keyframe-video-provider.js";
import { getLocalVideoProviderConfig } from "../../domain/providers/provider-config.js";
import { DEFAULT_OPENAI_IMAGE_TIMEOUT_MS, getConfiguredImageModel } from "./image-provider.js";

const DEFAULT_VIDEO_PROVIDER_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_VIDEO_PROVIDER_POLL_INTERVAL_MS = 2_000;
const MAX_PROVIDER_VIDEO_BYTES = 1024 * 1024 * 1024;

export type VideoProviderErrorCode =
  | "video_provider_not_configured"
  | "unsupported_video_mode"
  | "unsupported_provider_behavior"
  | "upstream_failure";

export class VideoProviderError extends Error {
  constructor(
    readonly code: VideoProviderErrorCode,
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export interface VideoProviderReferenceAsset {
  id: string;
  fileName: string;
  mimeType: string;
  dataUrl: string;
}

export interface VideoProviderProgress {
  progressPercent: number;
  progressStage: VideoGenerationProgressStage | string;
  progressMessage: string;
}

export interface VideoProviderInput extends GenerateVideoRequest {
  size: {
    width: number;
    height: number;
  };
  referenceAsset?: VideoProviderReferenceAsset;
  onProgress?: (progress: VideoProviderProgress) => void;
}

export interface VideoProviderOutput {
  bytes: Buffer;
  mimeType: string;
  fileName?: string;
  providerJobId?: string;
  size?: {
    width: number;
    height: number;
  };
}

export interface VideoProvider {
  readonly id: string;
  generate(input: VideoProviderInput, signal?: AbortSignal): Promise<VideoProviderOutput>;
}

interface CustomHttpVideoProviderConfig {
  id: string;
  endpointUrl?: string;
  textToVideoUrl?: string;
  imageToVideoUrl?: string;
  statusUrl?: string;
  apiKey?: string;
  timeoutMs: number;
  pollIntervalMs: number;
}

export function getVideoProviderStatus(): VideoProviderStatus {
  if (isKeyframeVideoProviderEnabled()) {
    return getKeyframeVideoProviderStatus();
  }

  const localConfig = getLocalVideoProviderConfig();
  if (localConfig) {
    if (localConfig.kind === "keyframe-image") {
      return {
        id: "keyframe-image",
        configured: true,
        supportsTextToVideo: true,
        supportsImageToVideo: false,
        message: "Local keyframe image video provider is configured."
      };
    }

    const supportsTextToVideo = Boolean(localConfig.baseUrl || localConfig.textToVideoUrl);
    const supportsImageToVideo = Boolean(localConfig.baseUrl || localConfig.imageToVideoUrl);

    return {
      id: "custom-http",
      configured: supportsTextToVideo || supportsImageToVideo,
      supportsTextToVideo,
      supportsImageToVideo,
      message: "Local custom HTTP video provider is configured."
    };
  }

  const config = getCustomHttpVideoProviderConfig();
  const supportsTextToVideo = Boolean(config.endpointUrl || config.textToVideoUrl);
  const supportsImageToVideo = Boolean(config.endpointUrl || config.imageToVideoUrl);
  const configured = supportsTextToVideo || supportsImageToVideo;

  return {
    id: config.id,
    configured,
    supportsTextToVideo,
    supportsImageToVideo,
    message: configured
      ? "Custom HTTP video provider is configured."
      : "Set VIDEO_PROVIDER_URL, VIDEO_PROVIDER_TEXT_TO_VIDEO_URL, or VIDEO_PROVIDER_IMAGE_TO_VIDEO_URL to enable video generation."
  };
}

export function getConfiguredVideoProvider():
  | {
      ok: true;
      provider: VideoProvider;
      status: VideoProviderStatus;
    }
  | {
      ok: false;
      error: VideoProviderError;
      status: VideoProviderStatus;
    } {
  if (isKeyframeVideoProviderEnabled()) {
    const status = getKeyframeVideoProviderStatus();
    if (!status.configured) {
      return {
        ok: false,
        status,
        error: new VideoProviderError(
          "video_provider_not_configured",
          "Keyframe video generation requires OPENAI_API_KEY for the image provider.",
          503
        )
      };
    }

    return {
      ok: true,
      status,
      provider: createKeyframeVideoProvider()
    };
  }

  const localConfig = getLocalVideoProviderConfig();
  if (localConfig) {
    const status = getVideoProviderStatus();
    if (!status.configured) {
      return {
        ok: false,
        status,
        error: new VideoProviderError(
          "video_provider_not_configured",
          "Video generation is not configured. Set a local video provider endpoint first.",
          503
        )
      };
    }

    if (localConfig.kind === "keyframe-image") {
      return {
        ok: true,
        status,
        provider: createLocalKeyframeVideoProvider({
          videoConfig: localConfig,
          imageModel: getConfiguredImageModel(),
          imageTimeoutMs: DEFAULT_OPENAI_IMAGE_TIMEOUT_MS
        })
      };
    }

    return {
      ok: true,
      status,
      provider: new CustomHttpVideoProvider({
        id: "custom-http",
        endpointUrl: localConfig.baseUrl,
        textToVideoUrl: localConfig.textToVideoUrl,
        imageToVideoUrl: localConfig.imageToVideoUrl,
        statusUrl: localConfig.statusUrl,
        apiKey: localConfig.apiKey,
        timeoutMs: localConfig.timeoutMs,
        pollIntervalMs: localConfig.pollIntervalMs
      })
    };
  }

  const config = getCustomHttpVideoProviderConfig();
  const status = getVideoProviderStatus();

  if (!status.configured) {
    return {
      ok: false,
      status,
      error: new VideoProviderError(
        "video_provider_not_configured",
        "Video generation is not configured. Set a custom HTTP video provider endpoint first.",
        503
      )
    };
  }

  return {
    ok: true,
    status,
    provider: new CustomHttpVideoProvider(config)
  };
}

class CustomHttpVideoProvider implements VideoProvider {
  readonly id: string;

  constructor(private readonly config: CustomHttpVideoProviderConfig) {
    this.id = config.id;
  }

  async generate(input: VideoProviderInput, signal?: AbortSignal): Promise<VideoProviderOutput> {
    const endpointUrl = endpointForMode(this.config, input.mode);
    if (!endpointUrl) {
      throw new VideoProviderError(
        "unsupported_video_mode",
        `The configured video provider does not support ${input.mode}.`,
        400
      );
    }

    const deadline = Date.now() + this.config.timeoutMs;
    const response = await fetchWithTimeout(
      endpointUrl,
      {
        method: "POST",
        headers: requestHeaders(this.config, { includeContentType: true }),
        body: JSON.stringify({
          mode: input.mode,
          prompt: input.prompt,
          durationSeconds: input.durationSeconds,
          aspectRatio: input.aspectRatio,
          size: input.size,
          referenceAsset: input.referenceAsset
        }),
        signal
      },
      remainingTimeoutMs(deadline)
    );

    if (!response.ok) {
      throw new VideoProviderError(
        "upstream_failure",
        await upstreamErrorMessage(response),
        providerHttpStatus(response.status)
      );
    }

    return readProviderVideoResponse(response, signal, this.config, deadline, endpointUrl);
  }
}

function getCustomHttpVideoProviderConfig(): CustomHttpVideoProviderConfig {
  return {
    id: process.env.VIDEO_PROVIDER_ID?.trim() || "custom-http",
    endpointUrl: normalizedEnvUrl(process.env.VIDEO_PROVIDER_URL),
    textToVideoUrl: normalizedEnvUrl(process.env.VIDEO_PROVIDER_TEXT_TO_VIDEO_URL),
    imageToVideoUrl: normalizedEnvUrl(process.env.VIDEO_PROVIDER_IMAGE_TO_VIDEO_URL),
    statusUrl: normalizedEnvUrlTemplate(process.env.VIDEO_PROVIDER_STATUS_URL),
    apiKey: process.env.VIDEO_PROVIDER_API_KEY?.trim() || undefined,
    timeoutMs: parsePositiveInteger(process.env.VIDEO_PROVIDER_TIMEOUT_MS, DEFAULT_VIDEO_PROVIDER_TIMEOUT_MS),
    pollIntervalMs: parsePositiveInteger(process.env.VIDEO_PROVIDER_POLL_INTERVAL_MS, DEFAULT_VIDEO_PROVIDER_POLL_INTERVAL_MS)
  };
}

function endpointForMode(config: CustomHttpVideoProviderConfig, mode: VideoGenerationMode): string | undefined {
  if (mode === "image_to_video") {
    return config.imageToVideoUrl ?? config.endpointUrl;
  }

  return config.textToVideoUrl ?? config.endpointUrl;
}

function requestHeaders(
  config: CustomHttpVideoProviderConfig,
  options: {
    includeContentType: boolean;
  }
): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json, video/*"
  };

  if (options.includeContentType) {
    headers["Content-Type"] = "application/json";
  }

  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  return headers;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const upstreamSignal = init.signal;
  const abortFromUpstream = (): void => controller.abort();

  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort();
    } else {
      upstreamSignal.addEventListener("abort", abortFromUpstream, { once: true });
    }
  }

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new VideoProviderError("upstream_failure", "Video provider request timed out or was cancelled.", 504);
    }
    if (error instanceof Error && error.message) {
      throw new VideoProviderError("upstream_failure", error.message, 502);
    }
    throw new VideoProviderError("upstream_failure", "Video provider request failed.", 502);
  } finally {
    clearTimeout(timeoutId);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}

async function readProviderVideoResponse(
  response: Response,
  signal: AbortSignal | undefined,
  config: CustomHttpVideoProviderConfig,
  deadline: number,
  baseUrl: string
): Promise<VideoProviderOutput> {
  const contentType = mediaType(response.headers.get("content-type"));
  if (contentType === "application/json") {
    return readProviderVideoJson(response, signal, config, deadline, baseUrl);
  }

  if (!isVideoMimeType(contentType)) {
    throw new VideoProviderError(
      "unsupported_provider_behavior",
      "Video provider returned a non-video content type.",
      502
    );
  }

  const bytes = await readResponseBytes(response);
  return {
    bytes,
    mimeType: contentType
  };
}

async function readProviderVideoJson(
  response: Response,
  signal: AbortSignal | undefined,
  config: CustomHttpVideoProviderConfig,
  deadline: number,
  baseUrl: string
): Promise<VideoProviderOutput> {
  const body = await response.json();
  const payload = firstVideoPayload(body);

  if (payload) {
    const output = await providerOutputFromPayload(payload, signal, config, deadline, baseUrl);
    if (output) {
      return output;
    }
  }

  const providerJob = providerJobFromJson(body, payload, config, baseUrl);
  if (providerJob) {
    return pollProviderVideoJob(providerJob, signal, config, deadline);
  }

  throw new VideoProviderError(
    "unsupported_provider_behavior",
    "Video provider JSON response did not include a video result.",
    502
  );
}

async function providerOutputFromPayload(
  payload: Record<string, unknown>,
  signal: AbortSignal | undefined,
  config: CustomHttpVideoProviderConfig,
  deadline: number,
  baseUrl: string
): Promise<VideoProviderOutput | undefined> {
  const mimeType = stringValue(payload.mimeType) ?? stringValue(payload.contentType);
  const fileName = stringValue(payload.fileName) ?? stringValue(payload.filename);
  const providerJobId = stringValue(payload.providerJobId) ?? stringValue(payload.jobId);
  const dataUrl = stringValue(payload.dataUrl) ?? stringValue(payload.videoDataUrl);
  const base64 = stringValue(payload.videoBase64) ?? stringValue(payload.b64Json) ?? stringValue(payload.base64);
  const url = stringValue(payload.url) ?? stringValue(payload.videoUrl) ?? stringValue(payload.downloadUrl);

  if (dataUrl) {
    return videoFromDataUrl(dataUrl, fileName, providerJobId);
  }

  if (base64) {
    const resolvedMimeType = normalizedVideoMimeType(mimeType) ?? mimeTypeFromFileName(fileName);
    if (!resolvedMimeType) {
      throw new VideoProviderError(
        "unsupported_provider_behavior",
        "Video provider base64 response is missing a video MIME type.",
        502
      );
    }
    return {
      bytes: ensureVideoByteLimit(Buffer.from(base64, "base64")),
      mimeType: resolvedMimeType,
      fileName,
      providerJobId
    };
  }

  if (url) {
    return downloadProviderVideoUrl(url, signal, config, deadline, baseUrl, {
      fallbackMimeType: mimeType,
      fileName,
      providerJobId
    });
  }

  return undefined;
}

function firstVideoPayload(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) {
    if (Array.isArray(value.outputs) && isRecord(value.outputs[0])) {
      return value.outputs[0];
    }
    if (Array.isArray(value.videos) && isRecord(value.videos[0])) {
      return value.videos[0];
    }
    return value;
  }

  return undefined;
}

function providerJobFromJson(
  body: unknown,
  payload: Record<string, unknown> | undefined,
  config: CustomHttpVideoProviderConfig,
  baseUrl: string
): {
  providerJobId: string;
  statusUrl: string;
} | undefined {
  const source = payload ?? (isRecord(body) ? body : undefined);
  if (!source) {
    return undefined;
  }

  const providerJobId = stringValue(source.providerJobId) ?? stringValue(source.jobId) ?? stringValue(source.id);
  const rawStatusUrl = stringValue(source.statusUrl) ?? stringValue(source.pollUrl);
  const statusUrl = rawStatusUrl ? resolveProviderUrl(rawStatusUrl, baseUrl) : statusUrlFromTemplate(config.statusUrl, providerJobId);

  if (!providerJobId || !statusUrl) {
    return undefined;
  }

  return {
    providerJobId,
    statusUrl
  };
}

async function pollProviderVideoJob(
  job: {
    providerJobId: string;
    statusUrl: string;
  },
  signal: AbortSignal | undefined,
  config: CustomHttpVideoProviderConfig,
  deadline: number
): Promise<VideoProviderOutput> {
  while (Date.now() < deadline) {
    await delay(config.pollIntervalMs, signal);

    const response = await fetchWithTimeout(
      job.statusUrl,
      {
        method: "GET",
        headers: requestHeaders(config, { includeContentType: false }),
        signal
      },
      remainingTimeoutMs(deadline)
    );
    if (!response.ok) {
      throw new VideoProviderError(
        "upstream_failure",
        await upstreamErrorMessage(response),
        providerHttpStatus(response.status)
      );
    }

    const contentType = mediaType(response.headers.get("content-type"));
    if (isVideoMimeType(contentType)) {
      return {
        bytes: await readResponseBytes(response),
        mimeType: contentType,
        providerJobId: job.providerJobId
      };
    }
    if (contentType !== "application/json") {
      throw new VideoProviderError(
        "unsupported_provider_behavior",
        "Video provider returned a non-video content type.",
        502
      );
    }

    const body = await response.json();
    const payload = firstVideoPayload(body);
    if (payload) {
      const output = await providerOutputFromPayload(payload, signal, config, deadline, job.statusUrl);
      if (output) {
        return output.providerJobId ? output : { ...output, providerJobId: job.providerJobId };
      }
    }

    const status = providerStatusFromJson(body, payload);
    if (status === "failed" || status === "cancelled") {
      throw new VideoProviderError(
        "upstream_failure",
        providerFailureMessage(body, payload),
        502
      );
    }
    if (status === "succeeded") {
      throw new VideoProviderError(
        "unsupported_provider_behavior",
        "Video provider marked the job complete without a video result.",
        502
      );
    }
  }

  throw new VideoProviderError("upstream_failure", "Video provider job timed out.", 504);
}

function providerStatusFromJson(body: unknown, payload: Record<string, unknown> | undefined): string | undefined {
  const source = payload ?? (isRecord(body) ? body : undefined);
  return stringValue(source?.status)?.toLowerCase();
}

function providerFailureMessage(body: unknown, payload: Record<string, unknown> | undefined): string {
  const source = payload ?? (isRecord(body) ? body : undefined);
  const message = stringValue(source?.message) ?? stringValue(source?.error) ?? "Video provider job failed.";
  return sanitizeVideoErrorMessage(message);
}

function videoFromDataUrl(dataUrl: string, fileName: string | undefined, providerJobId: string | undefined): VideoProviderOutput {
  const match = /^data:([^;,]+);base64,(.+)$/u.exec(dataUrl);
  const mimeType = normalizedVideoMimeType(match?.[1]);
  if (!match || !mimeType) {
    throw new VideoProviderError("unsupported_provider_behavior", "Video provider returned an unsupported data URL.", 502);
  }

  return {
    bytes: ensureVideoByteLimit(Buffer.from(match[2], "base64")),
    mimeType,
    fileName,
    providerJobId
  };
}

async function downloadProviderVideoUrl(
  url: string,
  signal: AbortSignal | undefined,
  config: CustomHttpVideoProviderConfig,
  deadline: number,
  baseUrl: string,
  options: {
    fallbackMimeType?: string;
    fileName?: string;
    providerJobId?: string;
  }
): Promise<VideoProviderOutput> {
  const parsedUrl = parseProviderUrl(resolveProviderUrl(url, baseUrl) ?? url);
  if (!parsedUrl) {
    throw new VideoProviderError("unsupported_provider_behavior", "Video provider returned an unsupported video URL.", 502);
  }

  const response = await fetchWithTimeout(
    parsedUrl.toString(),
    {
      headers: requestHeaders(config, { includeContentType: false }),
      signal
    },
    remainingTimeoutMs(deadline)
  );
  if (!response.ok) {
    throw new VideoProviderError("upstream_failure", "Video provider video download failed.", providerHttpStatus(response.status));
  }

  const mimeType = normalizedVideoMimeType(response.headers.get("content-type"));

  if (!mimeType) {
    throw new VideoProviderError(
      "unsupported_provider_behavior",
      "Video provider download did not return a video content type.",
      502
    );
  }

  return {
    bytes: await readResponseBytes(response),
    mimeType,
    fileName: options.fileName,
    providerJobId: options.providerJobId
  };
}

async function readResponseBytes(response: Response): Promise<Buffer> {
  const contentLength = parseContentLength(response.headers.get("content-length"));
  if (contentLength !== undefined && contentLength > MAX_PROVIDER_VIDEO_BYTES) {
    throw new VideoProviderError("unsupported_provider_behavior", "Video provider returned a file that is too large.", 502);
  }

  return ensureVideoByteLimit(Buffer.from(await response.arrayBuffer()));
}

function ensureVideoByteLimit(bytes: Buffer): Buffer {
  if (bytes.length === 0) {
    throw new VideoProviderError("unsupported_provider_behavior", "Video provider returned an empty file.", 502);
  }
  if (bytes.length > MAX_PROVIDER_VIDEO_BYTES) {
    throw new VideoProviderError("unsupported_provider_behavior", "Video provider returned a file that is too large.", 502);
  }
  return bytes;
}

async function upstreamErrorMessage(response: Response): Promise<string> {
  try {
    if (mediaType(response.headers.get("content-type")) === "application/json") {
      const body = (await response.json()) as unknown;
      if (isRecord(body)) {
        const message = stringValue(body.message) ?? (isRecord(body.error) ? stringValue(body.error.message) : undefined);
        if (message) {
          return sanitizeVideoErrorMessage(message);
        }
      }
    }
  } catch {
    return "Video provider request failed.";
  }

  return `Video provider request failed with status ${response.status}.`;
}

export function sanitizeVideoErrorMessage(message: string): string {
  return message
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "sk-[redacted]")
    .replace(/[A-Za-z]:\\[^\s"'<>]+/gu, "[path redacted]")
    .replace(/([?&](?:api[_-]?key|token|secret|signature)=)[^&\s]+/giu, "$1[redacted]")
    .trim()
    .slice(0, 1200);
}

function normalizedEnvUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function normalizedEnvUrlTemplate(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const probe = trimmed.replace("{jobId}", "job");
  try {
    const url = new URL(probe);
    return url.protocol === "http:" || url.protocol === "https:" ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

function parseProviderUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function resolveProviderUrl(value: string, baseUrl: string): string | undefined {
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function statusUrlFromTemplate(template: string | undefined, providerJobId: string | undefined): string | undefined {
  if (!template || !providerJobId) {
    return undefined;
  }

  return template.includes("{jobId}") ? template.replaceAll("{jobId}", encodeURIComponent(providerJobId)) : template;
}

function mediaType(value: string | null | undefined): string {
  return value?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function normalizedVideoMimeType(value: string | null | undefined): string | undefined {
  const type = mediaType(value);
  return isVideoMimeType(type) ? type : undefined;
}

function isVideoMimeType(value: string): boolean {
  return value.startsWith("video/");
}

function mimeTypeFromFileName(value: string | undefined): string | undefined {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.endsWith(".mp4") || normalized.endsWith(".m4v")) {
    return "video/mp4";
  }
  if (normalized.endsWith(".webm")) {
    return "video/webm";
  }
  if (normalized.endsWith(".mov")) {
    return "video/quicktime";
  }
  return undefined;
}

function providerHttpStatus(status: number | undefined): number {
  return typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502;
}

function parseContentLength(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function remainingTimeoutMs(deadline: number): number {
  return Math.max(1, deadline - Date.now());
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    const abort = (): void => {
      clearTimeout(timeout);
      reject(new VideoProviderError("upstream_failure", "Video provider request timed out or was cancelled.", 504));
    };

    if (signal?.aborted) {
      abort();
      return;
    }

    signal?.addEventListener("abort", abort, { once: true });
  });
}
