import type {
  GenerateVideoRequest,
  VideoGenerationMode,
  VideoGenerationProgressStage,
  VideoProviderKind,
  VideoProviderStatus
} from "../../domain/contracts.js";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { execFileSync } from "node:child_process";
import { Agent as HttpAgent, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { connect as tlsConnect } from "node:tls";
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
const MAX_PROVIDER_VIDEO_DOWNLOAD_ATTEMPTS = 3;
const MAX_PROVIDER_VIDEO_DOWNLOAD_REDIRECTS = 5;
const PROVIDER_VIDEO_DOWNLOAD_RETRY_DELAY_MS = 1_000;
const GROK_IMAGINE_PROVIDER_KIND = "grok-imagine";
const GROK_IMAGINE_DEFAULT_VIDEO_MODEL = "grok-imagine-video";
let cachedWindowsSystemProxyUrl: string | undefined;

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
  providerJobId?: string;
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
  videoModel: string;
  downloadProxyUrl?: string;
  timeoutMs: number;
  pollIntervalMs: number;
}

interface GrokImagineVideoProviderConfig {
  id: string;
  baseUrl: string;
  apiKey?: string;
  videoModel: string;
  downloadProxyUrl?: string;
  timeoutMs: number;
  pollIntervalMs: number;
}

interface VideoProviderSelectionOptions {
  providerKind?: VideoProviderKind;
}

export function getVideoProviderStatus(options: VideoProviderSelectionOptions = {}): VideoProviderStatus {
  if (options.providerKind) {
    return getRequestedVideoProviderStatus(options.providerKind);
  }

  const localConfig = getLocalVideoProviderConfig();
  if (localConfig) {
    return localVideoProviderStatus(localConfig);
  }

  if (isKeyframeVideoProviderEnabled()) {
    return getKeyframeVideoProviderStatus();
  }

  if (isGrokImagineVideoProviderEnabled()) {
    return envGrokImagineStatus();
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

export function getConfiguredVideoProvider(options: VideoProviderSelectionOptions = {}):
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
  if (options.providerKind) {
    return getRequestedConfiguredVideoProvider(options.providerKind);
  }

  const localConfig = getLocalVideoProviderConfig();
  if (localConfig) {
    const status = localVideoProviderStatus(localConfig);
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

    return {
      ok: true,
      status,
      provider: createLocalVideoProvider(localConfig)
    };
  }

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

  if (isGrokImagineVideoProviderEnabled()) {
    const status = envGrokImagineStatus();

    if (!status.configured) {
      return {
        ok: false,
        status,
        error: new VideoProviderError(
          "video_provider_not_configured",
          "Grok Imagine video generation requires VIDEO_PROVIDER_URL and VIDEO_PROVIDER_API_KEY.",
          503
        )
      };
    }

    return {
      ok: true,
      status,
      provider: new GrokImagineVideoProvider(getGrokImagineVideoProviderConfig())
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

function getRequestedVideoProviderStatus(providerKind: VideoProviderKind): VideoProviderStatus {
  if (providerKind === "keyframe-image" && isKeyframeVideoProviderEnabled()) {
    return getKeyframeVideoProviderStatus();
  }

  if (providerKind === GROK_IMAGINE_PROVIDER_KIND && isGrokImagineVideoProviderEnabled()) {
    return envGrokImagineStatus();
  }

  const localConfig = getLocalVideoProviderConfig(providerKind);
  if (localConfig?.kind === providerKind) {
    return localVideoProviderStatus(localConfig);
  }

  if (providerKind === "custom-http" && !isKeyframeVideoProviderEnabled() && !isGrokImagineVideoProviderEnabled()) {
    return customHttpVideoProviderStatus(getCustomHttpVideoProviderConfig());
  }

  return missingRequestedVideoProviderStatus(providerKind);
}

function getRequestedConfiguredVideoProvider(providerKind: VideoProviderKind):
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
  const status = getRequestedVideoProviderStatus(providerKind);
  if (!status.configured) {
    return {
      ok: false,
      status,
      error: new VideoProviderError(
        "video_provider_not_configured",
        `The requested ${providerKind} video provider is not configured.`,
        503
      )
    };
  }

  if (providerKind === "keyframe-image" && isKeyframeVideoProviderEnabled()) {
    return {
      ok: true,
      status,
      provider: createKeyframeVideoProvider()
    };
  }

  if (providerKind === GROK_IMAGINE_PROVIDER_KIND && isGrokImagineVideoProviderEnabled()) {
    return {
      ok: true,
      status,
      provider: new GrokImagineVideoProvider(getGrokImagineVideoProviderConfig())
    };
  }

  const localConfig = getLocalVideoProviderConfig(providerKind);
  if (localConfig?.kind === providerKind) {
    return {
      ok: true,
      status,
      provider: createLocalVideoProvider(localConfig)
    };
  }

  if (providerKind === "custom-http") {
    return {
      ok: true,
      status,
      provider: new CustomHttpVideoProvider(getCustomHttpVideoProviderConfig())
    };
  }

  return {
    ok: false,
    status,
    error: new VideoProviderError(
      "video_provider_not_configured",
      `The requested ${providerKind} video provider is not configured.`,
      503
    )
  };
}

function createLocalVideoProvider(localConfig: NonNullable<ReturnType<typeof getLocalVideoProviderConfig>>): VideoProvider {
  if (localConfig.kind === "keyframe-image") {
    return createLocalKeyframeVideoProvider({
      videoConfig: localConfig,
      imageModel: getConfiguredImageModel(),
      imageTimeoutMs: DEFAULT_OPENAI_IMAGE_TIMEOUT_MS
    });
  }

  if (localConfig.kind === GROK_IMAGINE_PROVIDER_KIND) {
    return new GrokImagineVideoProvider({
      id: GROK_IMAGINE_PROVIDER_KIND,
      baseUrl: requiredGrokImagineBaseUrl(localConfig.baseUrl),
      apiKey: localConfig.apiKey,
      videoModel: localConfig.videoModel || GROK_IMAGINE_DEFAULT_VIDEO_MODEL,
      downloadProxyUrl: getVideoProviderDownloadProxyUrl(),
      timeoutMs: localConfig.timeoutMs,
      pollIntervalMs: localConfig.pollIntervalMs
    });
  }

  return new CustomHttpVideoProvider({
    id: "custom-http",
    endpointUrl: localConfig.baseUrl,
    textToVideoUrl: localConfig.textToVideoUrl,
    imageToVideoUrl: localConfig.imageToVideoUrl,
    statusUrl: localConfig.statusUrl,
    apiKey: localConfig.apiKey,
    videoModel: localConfig.videoModel,
    downloadProxyUrl: getVideoProviderDownloadProxyUrl(),
    timeoutMs: localConfig.timeoutMs,
    pollIntervalMs: localConfig.pollIntervalMs
  });
}

function localVideoProviderStatus(localConfig: NonNullable<ReturnType<typeof getLocalVideoProviderConfig>>): VideoProviderStatus {
  if (localConfig.kind === "keyframe-image") {
    const configured = Boolean(localConfig.apiKey || process.env.OPENAI_API_KEY?.trim());

    return {
      id: "keyframe-image",
      configured,
      supportsTextToVideo: configured,
      supportsImageToVideo: false,
      message: configured
        ? "Local keyframe image video provider is configured."
        : "Set an OpenAI API key to enable local keyframe video generation."
    };
  }

  if (localConfig.kind === GROK_IMAGINE_PROVIDER_KIND) {
    const configured = Boolean(localConfig.apiKey && localConfig.baseUrl);

    return {
      id: GROK_IMAGINE_PROVIDER_KIND,
      configured,
      supportsTextToVideo: configured,
      supportsImageToVideo: false,
      message: configured
        ? "Local Grok Imagine video provider is configured."
        : "Set a Grok Imagine base URL and API key to enable video generation."
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

function envGrokImagineStatus(): VideoProviderStatus {
  const config = getGrokImagineVideoProviderConfigView();
  const configured = Boolean(config.apiKey && config.baseUrl);

  return {
    id: config.id,
    configured,
    supportsTextToVideo: configured,
    supportsImageToVideo: false,
    message: configured
      ? "Grok Imagine video provider is configured."
      : "Set VIDEO_PROVIDER_URL and VIDEO_PROVIDER_API_KEY to enable Grok Imagine video generation."
  };
}

function customHttpVideoProviderStatus(config: CustomHttpVideoProviderConfig): VideoProviderStatus {
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

function missingRequestedVideoProviderStatus(providerKind: VideoProviderKind): VideoProviderStatus {
  return {
    id: providerKind,
    configured: false,
    supportsTextToVideo: false,
    supportsImageToVideo: false,
    message: `The requested ${providerKind} video provider is not configured.`
  };
}

class CustomHttpVideoProvider implements VideoProvider {
  readonly id: string;

  constructor(private readonly config: CustomHttpVideoProviderConfig) {
    this.id = config.id;
  }

  async generate(input: VideoProviderInput, signal?: AbortSignal): Promise<VideoProviderOutput> {
    const baseUrl = endpointForMode(this.config, input.mode);
    if (!baseUrl) {
      throw new VideoProviderError(
        "unsupported_video_mode",
        `The configured video provider does not support ${input.mode}.`,
        400
      );
    }

    const deadline = Date.now() + this.config.timeoutMs;
    const apiBaseUrl = grok2ApiVideoApiBaseUrl(baseUrl);
    const createUrl = grok2ApiVideoCreateUrl(apiBaseUrl);
    const response = await fetchWithTimeout(
      createUrl,
      {
        method: "POST",
        headers: requestHeaders(this.config, { includeContentType: false }),
        body: grok2ApiVideoFormData(input, this.config.videoModel),
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

    return readProviderVideoResponse(response, signal, this.config, deadline, apiBaseUrl);
  }
}

class GrokImagineVideoProvider implements VideoProvider {
  readonly id: string;

  constructor(private readonly config: GrokImagineVideoProviderConfig) {
    this.id = config.id;
  }

  async generate(input: VideoProviderInput, signal?: AbortSignal): Promise<VideoProviderOutput> {
    if (input.mode === "image_to_video") {
      throw new VideoProviderError(
        "unsupported_video_mode",
        "The Grok Imagine video provider currently supports text-to-video only.",
        400
      );
    }

    input.onProgress?.({
      progressPercent: 5,
      progressStage: "preparing",
      progressMessage: "Creating Grok Imagine video task."
    });

    const deadline = Date.now() + this.config.timeoutMs;
    const endpoint = grokImagineEndpointForBaseUrl(this.config.baseUrl);
    const response = await fetchWithTimeout(
      endpoint.createUrl,
      {
        method: "POST",
        headers: requestHeaders(this.config, { includeContentType: true }),
        body: JSON.stringify(grokImagineCreateRequestBody(endpoint.protocol, input, this.config.videoModel)),
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

    if (mediaType(response.headers.get("content-type")) !== "application/json") {
      throw new VideoProviderError(
        "unsupported_provider_behavior",
        "Grok Imagine provider returned a non-JSON task response.",
        502
      );
    }

    const body = await response.json() as unknown;
    const taskId = grokImagineTaskIdFromJson(body);
    if (!taskId) {
      throw new VideoProviderError(
        "unsupported_provider_behavior",
        "Grok Imagine provider task response did not include a task id.",
        502
      );
    }

    input.onProgress?.({
      progressPercent: 10,
      progressStage: "running",
      progressMessage: "Grok Imagine video task is running.",
      providerJobId: taskId
    });

    return pollGrokImagineVideoTask({
      taskId,
      statusUrl: grokImagineStatusUrl(endpoint, taskId)
    }, input, signal, this.config, deadline);
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
    videoModel: process.env.VIDEO_PROVIDER_MODEL?.trim() || GROK_IMAGINE_DEFAULT_VIDEO_MODEL,
    downloadProxyUrl: getVideoProviderDownloadProxyUrl(),
    timeoutMs: parsePositiveInteger(process.env.VIDEO_PROVIDER_TIMEOUT_MS, DEFAULT_VIDEO_PROVIDER_TIMEOUT_MS),
    pollIntervalMs: parsePositiveInteger(process.env.VIDEO_PROVIDER_POLL_INTERVAL_MS, DEFAULT_VIDEO_PROVIDER_POLL_INTERVAL_MS)
  };
}

function isGrokImagineVideoProviderEnabled(): boolean {
  return process.env.VIDEO_PROVIDER_KIND?.trim().toLowerCase() === GROK_IMAGINE_PROVIDER_KIND;
}

function getGrokImagineVideoProviderConfig(): GrokImagineVideoProviderConfig {
  const config = getGrokImagineVideoProviderConfigView();
  return {
    id: GROK_IMAGINE_PROVIDER_KIND,
    baseUrl: requiredGrokImagineBaseUrl(config.baseUrl),
    apiKey: config.apiKey,
    videoModel: config.videoModel,
    downloadProxyUrl: config.downloadProxyUrl,
    timeoutMs: config.timeoutMs,
    pollIntervalMs: config.pollIntervalMs
  };
}

function getGrokImagineVideoProviderConfigView(): Omit<GrokImagineVideoProviderConfig, "baseUrl"> & {
  baseUrl?: string;
} {
  return {
    id: GROK_IMAGINE_PROVIDER_KIND,
    baseUrl: normalizedEnvUrl(process.env.VIDEO_PROVIDER_URL),
    apiKey: process.env.VIDEO_PROVIDER_API_KEY?.trim() || undefined,
    videoModel: process.env.VIDEO_PROVIDER_MODEL?.trim() || GROK_IMAGINE_DEFAULT_VIDEO_MODEL,
    downloadProxyUrl: getVideoProviderDownloadProxyUrl(),
    timeoutMs: parsePositiveInteger(process.env.VIDEO_PROVIDER_TIMEOUT_MS, DEFAULT_VIDEO_PROVIDER_TIMEOUT_MS),
    pollIntervalMs: parsePositiveInteger(process.env.VIDEO_PROVIDER_POLL_INTERVAL_MS, DEFAULT_VIDEO_PROVIDER_POLL_INTERVAL_MS)
  };
}

function requiredGrokImagineBaseUrl(value: string | undefined): string {
  if (!value) {
    throw new VideoProviderError(
      "video_provider_not_configured",
      "Grok Imagine video generation requires VIDEO_PROVIDER_URL.",
      503
    );
  }

  return value;
}

function getVideoProviderDownloadProxyUrl(): string | undefined {
  return (
    normalizedEnvUrl(process.env.VIDEO_PROVIDER_DOWNLOAD_PROXY_URL) ??
    normalizedEnvUrl(process.env.HTTPS_PROXY) ??
    normalizedEnvUrl(process.env.https_proxy) ??
    normalizedEnvUrl(process.env.HTTP_PROXY) ??
    normalizedEnvUrl(process.env.http_proxy) ??
    normalizedEnvUrl(process.env.ALL_PROXY) ??
    normalizedEnvUrl(process.env.all_proxy) ??
    getWindowsSystemProxyUrl()
  );
}

function endpointForMode(config: CustomHttpVideoProviderConfig, mode: VideoGenerationMode): string | undefined {
  if (mode === "image_to_video") {
    return config.imageToVideoUrl ?? config.endpointUrl;
  }

  return config.textToVideoUrl ?? config.endpointUrl;
}

function grok2ApiVideoApiBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    const normalizedPath = url.pathname.replace(/\/+$/u, "");
    if (/\/v1\/videos$/iu.test(normalizedPath)) {
      url.pathname = normalizedPath.replace(/\/videos$/iu, "");
      return url.toString();
    }
    if (normalizedPath.split("/").includes("v1")) {
      url.pathname = normalizedPath || "/";
      return url.toString();
    }
    url.pathname = `${normalizedPath}/v1`;
    return url.toString();
  } catch {
    return baseUrl;
  }
}

function grok2ApiVideoCreateUrl(apiBaseUrl: string): string {
  return joinProviderPath(apiBaseUrl, "videos");
}

function grok2ApiVideoStatusUrl(apiBaseUrl: string, providerJobId: string): string {
  return joinProviderPath(apiBaseUrl, `videos/${encodeURIComponent(providerJobId)}`);
}

function grok2ApiVideoContentUrl(apiBaseUrl: string, providerJobId: string): string {
  return joinProviderPath(apiBaseUrl, `videos/${encodeURIComponent(providerJobId)}/content`);
}

function grok2ApiVideoFormData(input: VideoProviderInput, videoModel: string): FormData {
  const form = new FormData();
  form.append("model", videoModel);
  form.append("prompt", input.prompt);
  form.append("seconds", String(input.durationSeconds));
  form.append("size", videoSizeString(input.size));
  form.append("resolution_name", "720p");
  form.append("preset", "custom");

  if (input.referenceAsset) {
    const file = videoReferenceAssetFile(input.referenceAsset);
    form.append("input_reference[]", file.blob, file.fileName);
  }

  return form;
}

function videoReferenceAssetFile(referenceAsset: VideoProviderReferenceAsset): { blob: Blob; fileName: string } {
  const match = /^data:([^;,]+);base64,(.+)$/u.exec(referenceAsset.dataUrl);
  const mimeType = match?.[1] || referenceAsset.mimeType;
  const bytes = Buffer.from(match?.[2] ?? "", "base64");
  return {
    blob: new Blob([bytes], { type: mimeType }),
    fileName: sanitizeVideoReferenceFileName(referenceAsset.fileName, mimeType)
  };
}

function sanitizeVideoReferenceFileName(fileName: string, mimeType: string): string {
  const sanitized = fileName.replace(/[^\w.-]+/gu, "_").replace(/^_+|_+$/gu, "");
  if (sanitized) {
    return sanitized;
  }

  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1] || "png";
  return `reference.${extension}`;
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
  const videoPayload = isRecord(payload.video) ? payload.video : undefined;
  const outputPayload = isRecord(payload.output) ? payload.output : undefined;
  const resultPayload = isRecord(payload.result) ? payload.result : undefined;
  const firstOutputVideoPayload = firstRecordFromArray(outputPayload?.videos);
  const firstResultVideoPayload = firstRecordFromArray(resultPayload?.videos);
  const mimeType = stringValue(payload.mimeType) ?? stringValue(payload.contentType) ?? stringValue(videoPayload?.mimeType) ?? stringValue(videoPayload?.contentType);
  const fileName = stringValue(payload.fileName) ?? stringValue(payload.filename) ?? stringValue(videoPayload?.fileName) ?? stringValue(videoPayload?.filename);
  const providerJobId =
    stringValue(payload.providerJobId) ??
    stringValue(payload.jobId) ??
    stringValue(payload.request_id) ??
    stringValue(payload.requestId) ??
    stringValue(payload.task_id) ??
    stringValue(payload.taskId) ??
    stringValue(videoPayload?.providerJobId) ??
    stringValue(videoPayload?.jobId) ??
    stringValue(videoPayload?.request_id) ??
    stringValue(videoPayload?.requestId) ??
    stringValue(videoPayload?.task_id) ??
    stringValue(videoPayload?.taskId);
  const dataUrl = stringValue(payload.dataUrl) ?? stringValue(payload.videoDataUrl) ?? stringValue(videoPayload?.dataUrl) ?? stringValue(videoPayload?.videoDataUrl);
  const base64 =
    stringValue(payload.videoBase64) ??
    stringValue(payload.b64Json) ??
    stringValue(payload.base64) ??
    stringValue(videoPayload?.videoBase64) ??
    stringValue(videoPayload?.b64Json) ??
    stringValue(videoPayload?.base64);
  const url =
    stringValue(payload.url) ??
    stringValue(payload.videoUrl) ??
    stringValue(payload.video_url) ??
    stringValue(payload.downloadUrl) ??
    stringValue(payload.download_url) ??
    stringValue(videoPayload?.url) ??
    stringValue(videoPayload?.videoUrl) ??
    stringValue(videoPayload?.video_url) ??
    stringValue(videoPayload?.downloadUrl) ??
    stringValue(videoPayload?.download_url) ??
    stringFromValue(firstArrayItem(outputPayload?.video_urls)) ??
    stringFromValue(firstArrayItem(outputPayload?.videoUrls)) ??
    stringFromValue(firstArrayItem(resultPayload?.video_urls)) ??
    stringFromValue(firstArrayItem(resultPayload?.videoUrls)) ??
    stringFromValue(firstArrayItem(firstOutputVideoPayload?.url)) ??
    stringValue(firstOutputVideoPayload?.url) ??
    stringValue(firstOutputVideoPayload?.videoUrl) ??
    stringValue(firstOutputVideoPayload?.video_url) ??
    stringFromValue(firstArrayItem(firstResultVideoPayload?.url)) ??
    stringValue(firstResultVideoPayload?.url) ??
    stringValue(firstResultVideoPayload?.videoUrl) ??
    stringValue(firstResultVideoPayload?.video_url);

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
    if (isRecord(value.data)) {
      return value.data;
    }
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

function firstRecordFromArray(value: unknown): Record<string, unknown> | undefined {
  return Array.isArray(value) && isRecord(value[0]) ? value[0] : undefined;
}

function firstArrayItem(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : undefined;
}

function providerJobFromJson(
  body: unknown,
  payload: Record<string, unknown> | undefined,
  config: CustomHttpVideoProviderConfig,
  baseUrl: string
): {
  providerJobId: string;
  statusUrl: string;
  apiBaseUrl: string;
} | undefined {
  const source = payload ?? (isRecord(body) ? body : undefined);
  if (!source) {
    return undefined;
  }

  const providerJobId =
    stringValue(source.providerJobId) ??
    stringValue(source.jobId) ??
    stringValue(source.request_id) ??
    stringValue(source.requestId) ??
    stringValue(source.task_id) ??
    stringValue(source.taskId) ??
    stringValue(source.video_id) ??
    stringValue(source.videoId) ??
    stringValue(source.id);
  const rawStatusUrl = stringValue(source.statusUrl) ?? stringValue(source.pollUrl);
  const statusUrl = rawStatusUrl
    ? resolveProviderUrl(rawStatusUrl, baseUrl)
    : statusUrlFromTemplate(config.statusUrl, providerJobId) ?? (providerJobId ? grok2ApiVideoStatusUrl(baseUrl, providerJobId) : undefined);

  if (!providerJobId || !statusUrl) {
    return undefined;
  }

  return {
    providerJobId,
    statusUrl,
    apiBaseUrl: baseUrl
  };
}

async function pollProviderVideoJob(
  job: {
    providerJobId: string;
    statusUrl: string;
    apiBaseUrl: string;
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
    if (isFailureStatus(status)) {
      throw new VideoProviderError(
        "upstream_failure",
        providerFailureMessage(body, payload),
        502
      );
    }
    if (isSuccessStatus(status)) {
      return downloadGrok2ApiVideoContent(job.apiBaseUrl, job.providerJobId, signal, config, deadline);
    }
  }

  throw new VideoProviderError("upstream_failure", "Video provider job timed out.", 504);
}

async function downloadGrok2ApiVideoContent(
  apiBaseUrl: string,
  providerJobId: string,
  signal: AbortSignal | undefined,
  config: CustomHttpVideoProviderConfig,
  deadline: number
): Promise<VideoProviderOutput> {
  const response = await fetchWithTimeout(
    grok2ApiVideoContentUrl(apiBaseUrl, providerJobId),
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

  const mimeType = normalizedVideoMimeType(response.headers.get("content-type"));
  if (!mimeType) {
    throw new VideoProviderError(
      "unsupported_provider_behavior",
      "Video provider content endpoint did not return a video content type.",
      502
    );
  }

  return {
    bytes: await readResponseBytes(response),
    mimeType,
    fileName: `${providerJobId}.mp4`,
    providerJobId
  };
}

async function pollGrokImagineVideoTask(
  task: {
    taskId: string;
    statusUrl: string;
  },
  input: VideoProviderInput,
  signal: AbortSignal | undefined,
  config: GrokImagineVideoProviderConfig,
  deadline: number
): Promise<VideoProviderOutput> {
  while (Date.now() < deadline) {
    await delay(config.pollIntervalMs, signal);

    const response = await fetchWithTimeout(
      task.statusUrl,
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
        providerJobId: task.taskId
      };
    }
    if (contentType !== "application/json") {
      throw new VideoProviderError(
        "unsupported_provider_behavior",
        "Grok Imagine provider returned a non-video content type.",
        502
      );
    }

    const body = await response.json() as unknown;
    const payload = firstVideoPayload(body);
    const progress = grokImagineProgressFromJson(body, payload, task.taskId);
    if (progress) {
      input.onProgress?.(progress);
    }

    if (payload) {
      const output = await providerOutputFromPayload(payload, signal, config, deadline, task.statusUrl);
      if (output) {
        return output.providerJobId ? output : { ...output, providerJobId: task.taskId };
      }
    }

    const status = grokImagineStatusFromJson(body, payload);
    if (isFailureStatus(status)) {
      throw new VideoProviderError(
        "upstream_failure",
        providerFailureMessage(body, payload),
        502
      );
    }
    if (isSuccessStatus(status)) {
      throw new VideoProviderError(
        "unsupported_provider_behavior",
        "Grok Imagine provider marked the task complete without a video result.",
        502
      );
    }
  }

  throw new VideoProviderError("upstream_failure", "Grok Imagine video task timed out.", 504);
}

type GrokImagineEndpointProtocol = "legacy-videos" | "newapi-video-generations" | "open-video-generations";

interface GrokImagineEndpoint {
  protocol: GrokImagineEndpointProtocol;
  baseUrl: string;
  createUrl: string;
  statusPath: string;
}

function grokImagineEndpointForBaseUrl(baseUrl: string): GrokImagineEndpoint {
  const usesNewApiRelay = isNewApiRelayUrl(baseUrl);
  const usesReApiRelay = isReApiRelayUrl(baseUrl);
  const usesApimartRelay = isApimartRelayUrl(baseUrl);
  const usesOpenVideoRelay = usesReApiRelay || usesApimartRelay;
  const apiBaseUrl = usesReApiRelay
    ? reApiGrokImagineApiBaseUrl(baseUrl)
    : usesNewApiRelay || usesApimartRelay
      ? grokImagineV1ApiBaseUrl(baseUrl)
      : baseUrl;
  if (usesOpenVideoRelay) {
    return {
      protocol: "open-video-generations",
      baseUrl: apiBaseUrl,
      createUrl: joinProviderPath(apiBaseUrl, "videos/generations"),
      statusPath: "tasks"
    };
  }
  if (usesNewApiRelay) {
    return {
      protocol: "newapi-video-generations",
      baseUrl: apiBaseUrl,
      createUrl: joinProviderPath(apiBaseUrl, "video/generations"),
      statusPath: "video/generations"
    };
  }

  return {
    protocol: "legacy-videos",
    baseUrl: apiBaseUrl,
    createUrl: joinProviderPath(apiBaseUrl, "videos"),
    statusPath: "videos"
  };
}

function grokImagineV1ApiBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    const normalizedPath = url.pathname.replace(/\/+$/u, "");
    if (normalizedPath.split("/").includes("v1")) {
      return baseUrl;
    }
    url.pathname = `${normalizedPath}/v1`;
    return url.toString();
  } catch {
    return baseUrl;
  }
}

function reApiGrokImagineApiBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    const normalizedPath = url.pathname.replace(/\/+$/u, "");
    if (/\/api\/v1$/iu.test(normalizedPath)) {
      return baseUrl;
    }
    url.pathname = `${normalizedPath}/api/v1`;
    return url.toString();
  } catch {
    return baseUrl;
  }
}

function isNewApiRelayUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    const normalizedHost = url.hostname.toLowerCase();
    const normalizedPath = url.pathname.toLowerCase();
    return normalizedHost.includes("newapi") || normalizedHost.includes("linuxdo") || normalizedPath.includes("newapi");
  } catch {
    return baseUrl.toLowerCase().includes("newapi");
  }
}

function isReApiRelayUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    const normalizedHost = url.hostname.toLowerCase();
    const normalizedPath = url.pathname.toLowerCase();
    return normalizedHost.includes("reapi") || normalizedPath.includes("reapi");
  } catch {
    return baseUrl.toLowerCase().includes("reapi");
  }
}

function isApimartRelayUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    const normalizedHost = url.hostname.toLowerCase();
    const normalizedPath = url.pathname.toLowerCase();
    return normalizedHost.includes("apimart") || normalizedPath.includes("apimart");
  } catch {
    return baseUrl.toLowerCase().includes("apimart");
  }
}

function grokImagineCreateRequestBody(
  protocol: GrokImagineEndpointProtocol,
  input: VideoProviderInput,
  videoModel: string
): Record<string, unknown> {
  if (protocol === "open-video-generations") {
    return {
      prompt: input.prompt,
      model: videoModel,
      size: input.aspectRatio,
      duration: Math.max(6, input.durationSeconds),
      quality: "720p"
    };
  }

  if (protocol === "newapi-video-generations") {
    return {
      prompt: input.prompt,
      model: videoModel,
      duration: input.durationSeconds,
      width: input.size.width,
      height: input.size.height,
      size: videoSizeString(input.size)
    };
  }

  return {
    prompt: input.prompt,
    model: videoModel,
    seconds: String(input.durationSeconds),
    size: videoSizeString(input.size)
  };
}

function grokImagineStatusUrl(endpoint: GrokImagineEndpoint, taskId: string): string {
  return joinProviderPath(endpoint.baseUrl, `${endpoint.statusPath}/${encodeURIComponent(taskId)}`);
}

function grokImagineTaskIdFromJson(body: unknown): string | undefined {
  const payload = firstVideoPayload(body);
  const source = payload ?? (isRecord(body) ? body : undefined);
  return stringValue(source?.request_id) ?? stringValue(source?.requestId) ?? stringValue(source?.task_id) ?? stringValue(source?.taskId) ?? stringValue(source?.id);
}

function grokImagineStatusFromJson(body: unknown, payload: Record<string, unknown> | undefined): string | undefined {
  const source = payload ?? (isRecord(body) ? body : undefined);
  return stringValue(source?.status)?.toLowerCase();
}

function grokImagineProgressFromJson(
  body: unknown,
  payload: Record<string, unknown> | undefined,
  taskId: string
): VideoProviderProgress | undefined {
  const source = payload ?? (isRecord(body) ? body : undefined);
  if (!source) {
    return undefined;
  }

  const rawProgress = numericValue(source.progress) ?? numericValue(source.progressPercent) ?? numericValue(source.progress_percent);
  if (rawProgress === undefined) {
    return undefined;
  }

  const status = grokImagineStatusFromJson(body, payload);
  const message =
    stringValue(source.message) ??
    stringValue(source.progressMessage) ??
    stringValue(source.progress_message) ??
    (status ? `Grok Imagine task ${status}.` : "Grok Imagine video task is running.");

  return {
    progressPercent: rawProgress > 0 && rawProgress <= 1 ? rawProgress * 100 : rawProgress,
    progressStage: isSuccessStatus(status) ? "saving" : "running",
    progressMessage: sanitizeVideoErrorMessage(message),
    providerJobId: taskId
  };
}

function isSuccessStatus(status: string | undefined): boolean {
  return status === "succeeded" || status === "success" || status === "completed" || status === "complete" || status === "done" || status === "finished";
}

function isFailureStatus(status: string | undefined): boolean {
  return status === "failed" || status === "failure" || status === "cancelled" || status === "canceled" || status === "error";
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
  const downloadHeaders = requestHeadersForVideoDownload(config, parsedUrl, baseUrl);

  let lastRetryableError: VideoProviderError | undefined;
  for (let attempt = 1; attempt <= MAX_PROVIDER_VIDEO_DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchProviderVideoDownload(
        parsedUrl,
        {
          headers: downloadHeaders,
          signal
        },
        config,
        baseUrl,
        remainingTimeoutMs(deadline)
      );
      if (!response.ok) {
        const error = new VideoProviderError(
          "upstream_failure",
          `Video provider video download from ${parsedUrl.hostname} failed with status ${response.status}.`,
          providerHttpStatus(response.status)
        );
        if (attempt < MAX_PROVIDER_VIDEO_DOWNLOAD_ATTEMPTS && isRetryableVideoDownloadError(error)) {
          lastRetryableError = error;
          await delay(PROVIDER_VIDEO_DOWNLOAD_RETRY_DELAY_MS * attempt, signal);
          continue;
        }
        if (isRetryableVideoDownloadError(error)) {
          throw decorateVideoDownloadError(error, parsedUrl, Boolean(config.downloadProxyUrl), options.providerJobId);
        }
        throw error;
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
    } catch (error) {
      if (error instanceof VideoProviderError && isRetryableVideoDownloadError(error)) {
        if (attempt < MAX_PROVIDER_VIDEO_DOWNLOAD_ATTEMPTS) {
          lastRetryableError = error;
          await delay(PROVIDER_VIDEO_DOWNLOAD_RETRY_DELAY_MS * attempt, signal);
          continue;
        }

        throw decorateVideoDownloadError(error, parsedUrl, Boolean(config.downloadProxyUrl), options.providerJobId);
      }

      throw error;
    }
  }

  throw decorateVideoDownloadError(lastRetryableError, parsedUrl, Boolean(config.downloadProxyUrl), options.providerJobId) ?? new VideoProviderError(
    "upstream_failure",
    `Video provider video download from ${parsedUrl.hostname} failed.`,
    502
  );
}

async function fetchProviderVideoDownload(
  parsedUrl: URL,
  init: {
    headers: HeadersInit;
    signal: AbortSignal | undefined;
  },
  config: CustomHttpVideoProviderConfig,
  baseUrl: string,
  timeoutMs: number,
  redirectCount = 0
): Promise<Response> {
  const response = config.downloadProxyUrl
    ? await fetchWithDownloadProxy(parsedUrl, init.headers, config.downloadProxyUrl, init.signal, timeoutMs)
    : await fetchWithTimeout(
        parsedUrl.toString(),
        {
          headers: init.headers,
          signal: init.signal
        },
        timeoutMs
      );

  if (!isRedirectStatus(response.status)) {
    return response;
  }

  if (redirectCount >= MAX_PROVIDER_VIDEO_DOWNLOAD_REDIRECTS) {
    throw new VideoProviderError("upstream_failure", "Video provider video download followed too many redirects.", 502);
  }

  const location = response.headers.get("location");
  const redirectedUrl = location ? parseProviderUrl(resolveProviderUrl(location, parsedUrl.toString()) ?? "") : undefined;
  if (!redirectedUrl) {
    throw new VideoProviderError("upstream_failure", "Video provider video download returned an invalid redirect.", 502);
  }

  return fetchProviderVideoDownload(
    redirectedUrl,
    {
      headers: requestHeadersForVideoDownload(config, redirectedUrl, baseUrl),
      signal: init.signal
    },
    config,
    baseUrl,
    timeoutMs,
    redirectCount + 1
  );
}

function requestHeadersForVideoDownload(
  config: CustomHttpVideoProviderConfig,
  downloadUrl: URL,
  baseUrl: string
): HeadersInit {
  const headers = headersToRecord(requestHeaders(config, { includeContentType: false }));
  if (!isSameOrigin(downloadUrl, baseUrl)) {
    delete headers.Authorization;
    delete headers.authorization;
  }

  return headers;
}

function isSameOrigin(url: URL, baseUrl: string): boolean {
  const parsedBaseUrl = parseProviderUrl(baseUrl);
  return Boolean(parsedBaseUrl && parsedBaseUrl.origin === url.origin);
}

async function fetchWithDownloadProxy(
  targetUrl: URL,
  headers: HeadersInit,
  proxyUrlValue: string,
  signal: AbortSignal | undefined,
  timeoutMs: number
): Promise<Response> {
  const proxyUrl = parseProxyUrl(proxyUrlValue);
  if (!proxyUrl) {
    throw new VideoProviderError("upstream_failure", "VIDEO_PROVIDER_DOWNLOAD_PROXY_URL must be an http or https URL.", 502);
  }

  try {
    if (targetUrl.protocol === "http:") {
      return await fetchHttpUrlViaProxy(targetUrl, headersToRecord(headers), proxyUrl, signal, timeoutMs);
    }

    return await fetchHttpsUrlViaProxy(targetUrl, headersToRecord(headers), proxyUrl, signal, timeoutMs);
  } catch (error) {
    if (error instanceof VideoProviderError) {
      throw error;
    }

    const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
    throw new VideoProviderError(
      "upstream_failure",
      sanitizeVideoErrorMessage(`Video provider video download from ${targetUrl.hostname} through VIDEO_PROVIDER_DOWNLOAD_PROXY_URL failed.${detail}`),
      502
    );
  }
}

function fetchHttpUrlViaProxy(
  targetUrl: URL,
  headers: Record<string, string>,
  proxyUrl: URL,
  signal: AbortSignal | undefined,
  timeoutMs: number
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    let cleanup = (): void => undefined;
    const request = proxyRequest(proxyUrl)({
      method: "GET",
      hostname: proxyUrl.hostname,
      port: proxyPort(proxyUrl),
      path: targetUrl.toString(),
      headers: {
        ...headers,
        Host: targetUrl.host,
        Connection: "close",
        ...proxyAuthorizationHeaders(proxyUrl)
      }
    }, (response) => {
      collectIncomingResponse(response).then((proxiedResponse) => {
        cleanup();
        resolve(proxiedResponse);
      }, (error) => {
        cleanup();
        reject(error);
      });
    });

    cleanup = attachNodeRequestLifecycle({
      request,
      signal,
      timeoutMs
    });

    request.on("error", (error) => {
      cleanup();
      reject(error);
    });
    request.end();
  });
}

function fetchHttpsUrlViaProxy(
  targetUrl: URL,
  headers: Record<string, string>,
  proxyUrl: URL,
  signal: AbortSignal | undefined,
  timeoutMs: number
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const connectRequest = proxyRequest(proxyUrl)({
      method: "CONNECT",
      hostname: proxyUrl.hostname,
      port: proxyPort(proxyUrl),
      path: `${targetUrl.hostname}:${targetPort(targetUrl)}`,
      headers: {
        Host: `${targetUrl.hostname}:${targetPort(targetUrl)}`,
        ...proxyAuthorizationHeaders(proxyUrl)
      }
    });
    let cleanupTarget: (() => void) | undefined;

    const cleanupConnect = attachNodeRequestLifecycle({
      request: connectRequest,
      signal,
      timeoutMs
    });

    connectRequest.on("connect", (connectResponse, socket) => {
      cleanupConnect();
      if ((connectResponse.statusCode ?? 502) !== 200) {
        socket.destroy();
        resolve(new Response(null, {
          status: responseHttpStatus(connectResponse.statusCode),
          headers: incomingHeadersToRecord(connectResponse.headers)
        }));
        return;
      }

      const tlsSocket = tlsConnect({
        socket,
        servername: targetUrl.hostname
      });

      const abort = (): void => {
        tlsSocket.destroy(new VideoProviderError("upstream_failure", "Video provider request timed out or was cancelled.", 504));
      };
      const timeout = setTimeout(abort, timeoutMs);
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });

      const cleanupTls = (): void => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
      };

      tlsSocket.once("secureConnect", () => {
        const agent = new HttpAgent({ keepAlive: false });
        agent.createConnection = () => tlsSocket;
        const targetRequest = httpRequest({
          method: "GET",
          hostname: targetUrl.hostname,
          port: targetPort(targetUrl),
          path: pathWithSearch(targetUrl),
          headers: {
            ...headers,
            Host: targetUrl.host,
            Connection: "close"
          },
          agent
        }, (response) => {
          collectIncomingResponse(response).then((proxiedResponse) => {
            cleanupTls();
            cleanupTarget?.();
            resolve(proxiedResponse);
          }, (error) => {
            cleanupTls();
            cleanupTarget?.();
            reject(error);
          });
        });

        cleanupTarget = attachNodeRequestLifecycle({
          request: targetRequest,
          signal,
          timeoutMs
        });
        targetRequest.on("error", (error) => {
          cleanupTls();
          cleanupTarget?.();
          reject(error);
        });
        targetRequest.end();
      });

      tlsSocket.once("error", (error) => {
        cleanupTls();
        cleanupTarget?.();
        reject(error);
      });
    });

    connectRequest.on("error", (error) => {
      cleanupConnect();
      cleanupTarget?.();
      reject(error);
    });
    connectRequest.end();
  });
}

function attachNodeRequestLifecycle(input: {
  request: ReturnType<typeof httpRequest>;
  signal: AbortSignal | undefined;
  timeoutMs: number;
}): () => void {
  const abort = (): void => {
    input.request.destroy(new VideoProviderError("upstream_failure", "Video provider request timed out or was cancelled.", 504));
  };
  const timeout = setTimeout(abort, input.timeoutMs);

  if (input.signal?.aborted) {
    abort();
  } else {
    input.signal?.addEventListener("abort", abort, { once: true });
  }

  return () => {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", abort);
  };
}

function collectIncomingResponse(response: IncomingMessage): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const chunks: Buffer[] = [];
    response.on("data", (chunk: Buffer) => chunks.push(chunk));
    response.on("error", reject);
    response.on("end", () => {
      resolve(new Response(Buffer.concat(chunks), {
        status: responseHttpStatus(response.statusCode),
        headers: incomingHeadersToRecord(response.headers)
      }));
    });
  });
}

function incomingHeadersToRecord(headers: IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      result[key] = value;
    } else if (Array.isArray(value)) {
      result[key] = value.join(", ");
    }
  }
  return result;
}

function headersToRecord(headers: HeadersInit): Record<string, string> {
  if (headers instanceof Headers) {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return {
    ...headers
  };
}

function proxyRequest(proxyUrl: URL): typeof httpRequest {
  return proxyUrl.protocol === "https:" ? httpsRequest : httpRequest;
}

function proxyPort(proxyUrl: URL): number {
  return Number.parseInt(proxyUrl.port || (proxyUrl.protocol === "https:" ? "443" : "80"), 10);
}

function targetPort(targetUrl: URL): number {
  return Number.parseInt(targetUrl.port || (targetUrl.protocol === "https:" ? "443" : "80"), 10);
}

function pathWithSearch(url: URL): string {
  return `${url.pathname || "/"}${url.search}`;
}

function proxyAuthorizationHeaders(proxyUrl: URL): Record<string, string> {
  if (!proxyUrl.username && !proxyUrl.password) {
    return {};
  }

  const username = decodeURIComponent(proxyUrl.username);
  const password = decodeURIComponent(proxyUrl.password);
  return {
    "Proxy-Authorization": `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
  };
}

function parseProxyUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function getWindowsSystemProxyUrl(): string | undefined {
  if (process.platform !== "win32") {
    return undefined;
  }
  if (cachedWindowsSystemProxyUrl !== undefined) {
    return cachedWindowsSystemProxyUrl;
  }

  cachedWindowsSystemProxyUrl = readWindowsSystemProxyUrl();
  return cachedWindowsSystemProxyUrl;
}

function readWindowsSystemProxyUrl(): string | undefined {
  try {
    const output = execFileSync(
      "reg",
      [
        "query",
        "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
        "/v",
        "ProxyEnable"
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 1_000
      }
    );
    if (!/\bProxyEnable\b[^\r\n]*\b0x1\b/iu.test(output)) {
      return undefined;
    }

    const proxyOutput = execFileSync(
      "reg",
      [
        "query",
        "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
        "/v",
        "ProxyServer"
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 1_000
      }
    );
    const match = /\bProxyServer\b\s+REG_\w+\s+([^\r\n]+)/iu.exec(proxyOutput);
    return normalizedWindowsProxyServer(match?.[1]);
  } catch {
    return undefined;
  }
}

function normalizedWindowsProxyServer(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const httpsProxy =
    trimmed
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.toLowerCase().startsWith("https="))
      ?.slice("https=".length) ??
    trimmed
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.toLowerCase().startsWith("http="))
      ?.slice("http=".length) ??
    trimmed;
  const proxyUrl = /^[a-z][a-z0-9+.-]*:\/\//iu.test(httpsProxy) ? httpsProxy : `http://${httpsProxy}`;
  return normalizedEnvUrl(proxyUrl);
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function decorateVideoDownloadError(
  error: VideoProviderError | undefined,
  parsedUrl: URL,
  usedProxy: boolean,
  providerJobId: string | undefined
): VideoProviderError | undefined {
  if (!error) {
    return undefined;
  }

  const proxyHint = usedProxy
    ? "Check VIDEO_PROVIDER_DOWNLOAD_PROXY_URL or the local proxy reachability."
    : "Configure VIDEO_PROVIDER_DOWNLOAD_PROXY_URL if the provider CDN is unreachable from this machine.";
  const taskHint = providerJobId ? ` Remote provider task id: ${providerJobId}.` : "";

  return new VideoProviderError(
    error.code,
    sanitizeVideoErrorMessage(
      `Video provider returned a video URL on ${parsedUrl.hostname}, but this server could not download it.${taskHint} ${error.message} ${proxyHint}`
    ),
    error.status
  );
}

function isRetryableVideoDownloadError(error: VideoProviderError): boolean {
  return error.code === "upstream_failure" && isRetryableVideoDownloadStatus(error.status);
}

function isRetryableVideoDownloadStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
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
        const message = upstreamJsonErrorMessage(body);
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

function upstreamJsonErrorMessage(body: Record<string, unknown>): string | undefined {
  const nested = nestedJsonError(body);
  const directMessage = stringValue(body.message) ?? (isRecord(body.error) ? stringValue(body.error.message) : undefined);
  const message = nested?.message ?? directMessage;
  const param = nested?.param ?? (isRecord(body.error) ? stringValue(body.error.param) : undefined);
  if (message && param === "model") {
    return `${message} The upstream video gateway reported that its downstream request is missing model, even though this app sends the configured video model. Check whether the relay supports this model on its openai-video endpoint.`;
  }
  return message;
}

function nestedJsonError(body: Record<string, unknown>): { message?: string; param?: string } | undefined {
  const value = stringValue(body.message) ?? (isRecord(body.error) ? stringValue(body.error.message) : undefined);
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (isRecord(parsed)) {
      const nested = nestedJsonError(parsed);
      return {
        message: nested?.message ?? stringValue(parsed.message) ?? (isRecord(parsed.error) ? stringValue(parsed.error.message) : undefined),
        param: nested?.param ?? (isRecord(parsed.error) ? stringValue(parsed.error.param) : undefined)
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
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

function joinProviderPath(baseUrl: string, path: string): string {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\/+/u, ""), normalizedBaseUrl).toString();
}

function videoSizeString(size: { width: number; height: number }): string {
  return `${size.width}x${size.height}`;
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

function responseHttpStatus(status: number | undefined): number {
  return typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : 502;
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

function stringFromValue(value: unknown): string | undefined {
  return stringValue(value);
}

function numericValue(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value.trim())
        : Number.NaN;

  return Number.isFinite(parsed) ? parsed : undefined;
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
