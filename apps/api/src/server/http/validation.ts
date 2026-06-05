import {
  GENERATION_COUNTS,
  DEFAULT_VIDEO_DURATION_SECONDS,
  IMAGE_PROVIDER_FORMATS,
  IMAGE_QUALITIES,
  MAX_REFERENCE_IMAGES,
  OUTPUT_FORMATS,
  PROVIDER_SOURCE_IDS,
  SIZE_PRESETS,
  STYLE_PRESETS,
  VIDEO_ASPECT_RATIOS,
  VIDEO_DURATION_PRESETS,
  composePrompt,
  validateSceneImageSize,
  type GenerateVideoRequest,
  type GenerationCount,
  type ImageQuality,
  type ImageProviderFormat,
  type ImageSize,
  type OutputFormat,
  type ProviderSourceId,
  type ReferenceImageInput,
  type SaveAgentLlmConfigRequest,
  type SaveLocalOpenAIProviderConfig,
  type SaveProviderConfigRequest,
  type SaveStorageConfigRequest,
  type SaveVideoProviderConfig,
  type StylePresetId,
  type VideoAspectRatio,
  type VideoBatchDeleteRequest,
  type VideoDurationPreset,
  type VideoGenerationMode,
  type VideoProviderKind
} from "../../domain/contracts.js";
import { getStoredAssetFile } from "../../domain/generation/image-generation.js";
import { isGeneratedImageAsset } from "../../domain/video/video-generation.js";
import { isProviderSourceOrder } from "../../domain/providers/provider-config.js";
import type { EditImageProviderInput, ImageProviderInput } from "../../infrastructure/providers/image-provider.js";
import { errorResponse, type ErrorResponseBody, type ParseResult } from "./errors.js";

const MAX_PROJECT_SNAPSHOT_BYTES = 100 * 1024 * 1024;
const MAX_PROJECT_NAME_LENGTH = 120;

export interface ProjectPayload {
  name?: string;
  snapshotJson: string;
}

export function logProjectSaveRejected(error: ErrorResponseBody, request: Request): void {
  console.warn(
    `Project save rejected: ${error.error.code}. ${error.error.message}${formatRequestBodySummary(request)}`
  );
}

function formatRequestBodySummary(request: Request): string {
  const contentType = sanitizeHeaderValue(request.headers.get("content-type"));
  const contentLength = sanitizeHeaderValue(request.headers.get("content-length"));
  const transferEncoding = sanitizeHeaderValue(request.headers.get("transfer-encoding"));
  const bodySize = contentLength
    ? `content-length=${contentLength}`
    : transferEncoding
      ? `transfer-encoding=${transferEncoding}`
      : "content-length=unknown";

  return ` (${bodySize}, content-type=${contentType || "missing"})`;
}

function sanitizeHeaderValue(value: string | null): string {
  return (value ?? "").replace(/[\r\n]/gu, " ").trim().slice(0, 120);
}

export function parseGeneratePayload(input: unknown): ParseResult<ImageProviderInput> {
  const base = parseBaseImagePayload(input);
  if (!base.ok) {
    return base;
  }

  return {
    ok: true,
    value: base.value
  };
}

export function parseVideoGeneratePayload(input: unknown): ParseResult<GenerateVideoRequest> {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_request", "Video generation payload must be a JSON object.")
    };
  }

  const prompt = input.prompt;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return {
      ok: false,
      error: errorResponse("invalid_prompt", "Please enter a video prompt.")
    };
  }

  const mode = parseVideoMode(input.mode);
  if (!mode.ok) {
    return mode;
  }

  const durationSeconds = parseVideoDuration(input.durationSeconds);
  if (!durationSeconds.ok) {
    return durationSeconds;
  }

  const aspectRatio = parseVideoAspectRatio(input.aspectRatio);
  if (!aspectRatio.ok) {
    return aspectRatio;
  }

  const referenceAssetId = parseOptionalString(input.referenceAssetId);
  const providerKind = parseVideoProviderKind(input.providerKind);
  if (Object.hasOwn(input, "providerKind") && !providerKind) {
    return {
      ok: false,
      error: errorResponse("invalid_video_provider", "Unsupported video provider kind.")
    };
  }

  if (mode.value === "image_to_video") {
    if (!referenceAssetId) {
      return {
        ok: false,
        error: errorResponse("invalid_reference_asset", "Image-to-video requires an existing generated image asset.")
      };
    }

    const referenceAsset = getStoredAssetFile(referenceAssetId);
    if (!referenceAsset || !referenceAsset.mimeType.startsWith("image/") || !isGeneratedImageAsset(referenceAssetId)) {
      return {
        ok: false,
        error: errorResponse("invalid_reference_asset", "Image-to-video requires an existing generated image asset.")
      };
    }
  }

  return {
    ok: true,
    value: {
      prompt: prompt.trim(),
      mode: mode.value,
      durationSeconds: durationSeconds.value,
      aspectRatio: aspectRatio.value,
      referenceAssetId: mode.value === "image_to_video" ? referenceAssetId : undefined,
      providerKind
    }
  };
}

export function parseVideoBatchDeletePayload(input: unknown): ParseResult<VideoBatchDeleteRequest> {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_request", "Video batch delete payload must be a JSON object.")
    };
  }

  if (!Array.isArray(input.outputIds)) {
    return {
      ok: false,
      error: errorResponse("invalid_output_ids", "Video batch delete outputIds must be an array.")
    };
  }

  const outputIds: string[] = [];
  const seen = new Set<string>();
  for (const value of input.outputIds) {
    const outputId = parseOptionalString(value);
    if (!outputId) {
      return {
        ok: false,
        error: errorResponse("invalid_output_ids", "Video batch delete outputIds must contain non-empty strings.")
      };
    }

    if (!seen.has(outputId)) {
      seen.add(outputId);
      outputIds.push(outputId);
    }
  }

  if (outputIds.length === 0) {
    return {
      ok: false,
      error: errorResponse("invalid_output_ids", "Video batch delete requires at least one output id.")
    };
  }

  return {
    ok: true,
    value: {
      outputIds
    }
  };
}

export function parseCodexPollPayload(input: unknown): ParseResult<{ deviceAuthId: string; userCode: string }> {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_request", "Codex 登录轮询请求必须是 JSON 对象。")
    };
  }

  const deviceAuthId = parseOptionalString(input.deviceAuthId);
  const userCode = parseOptionalString(input.userCode);

  if (!deviceAuthId || !userCode) {
    return {
      ok: false,
      error: errorResponse("invalid_request", "Codex 登录轮询缺少设备码。")
    };
  }

  return {
    ok: true,
    value: {
      deviceAuthId,
      userCode
    }
  };
}

export function parseEditPayload(input: unknown): ParseResult<EditImageProviderInput> {
  const base = parseBaseImagePayload(input);
  if (!base.ok) {
    return base;
  }

  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("unsupported_provider_behavior", "编辑图像需要提供 1-3 张参考图像。")
    };
  }

  const referenceImages = parseReferenceImages(input);
  if (!referenceImages.ok) {
    return referenceImages;
  }

  const referenceAssetIds = parseReferenceAssetIds(input, referenceImages.value.length);
  if (!referenceAssetIds.ok) {
    return referenceAssetIds;
  }

  for (const referenceAssetId of referenceAssetIds.value) {
    if (!getStoredAssetFile(referenceAssetId)) {
      return {
        ok: false,
        error: errorResponse("invalid_request", "找不到可记录的参考图像资源。")
      };
    }
  }

  return {
    ok: true,
    value: {
      ...base.value,
      referenceImages: referenceImages.value,
      referenceImage: referenceImages.value[0],
      referenceAssetIds: referenceAssetIds.value.length > 0 ? referenceAssetIds.value : undefined,
      referenceAssetId: referenceAssetIds.value[0]
    }
  };
}

function parseReferenceImages(input: Record<string, unknown>): ParseResult<ReferenceImageInput[]> {
  const rawReferenceImages = Array.isArray(input.referenceImages)
    ? input.referenceImages
    : isRecord(input.referenceImage)
      ? [input.referenceImage]
      : undefined;

  if (!rawReferenceImages) {
    return {
      ok: false,
      error: errorResponse("unsupported_provider_behavior", "编辑图像需要提供 1-3 张参考图像。")
    };
  }

  if (rawReferenceImages.length < 1 || rawReferenceImages.length > MAX_REFERENCE_IMAGES) {
    return {
      ok: false,
      error: errorResponse("unsupported_provider_behavior", `参考图像数量必须是 1-${MAX_REFERENCE_IMAGES} 张。`)
    };
  }

  const referenceImages: ReferenceImageInput[] = [];
  for (const rawReferenceImage of rawReferenceImages) {
    if (!isRecord(rawReferenceImage)) {
      return {
        ok: false,
        error: errorResponse("unsupported_provider_behavior", "参考图像格式不受支持。")
      };
    }

    const dataUrl = rawReferenceImage.dataUrl;
    if (typeof dataUrl !== "string" || dataUrl.trim().length === 0) {
      return {
        ok: false,
        error: errorResponse("unsupported_provider_behavior", "参考图像格式不受支持。")
      };
    }

    const fileName = rawReferenceImage.fileName;
    referenceImages.push({
      dataUrl,
      fileName: typeof fileName === "string" && fileName.trim() ? fileName.trim() : undefined
    });
  }

  return {
    ok: true,
    value: referenceImages
  };
}

function parseReferenceAssetIds(input: Record<string, unknown>, referenceImageCount: number): ParseResult<string[]> {
  const legacyReferenceAssetId = parseOptionalString(input.referenceAssetId);
  const rawReferenceAssetIds = Array.isArray(input.referenceAssetIds)
    ? input.referenceAssetIds
    : legacyReferenceAssetId
      ? [legacyReferenceAssetId]
      : [];

  if (
    rawReferenceAssetIds.length > MAX_REFERENCE_IMAGES ||
    (rawReferenceAssetIds.length > 0 && rawReferenceAssetIds.length !== referenceImageCount)
  ) {
    return {
      ok: false,
      error: errorResponse("invalid_request", "参考图像资源 ID 数量必须与参考图像数量一致。")
    };
  }

  const referenceAssetIds: string[] = [];
  for (const rawReferenceAssetId of rawReferenceAssetIds) {
    const referenceAssetId = parseOptionalString(rawReferenceAssetId);
    if (!referenceAssetId) {
      return {
        ok: false,
        error: errorResponse("invalid_request", "参考图像资源 ID 格式不受支持。")
      };
    }

    referenceAssetIds.push(referenceAssetId);
  }

  return {
    ok: true,
    value: referenceAssetIds
  };
}

function parseVideoMode(value: unknown): ParseResult<VideoGenerationMode> {
  if (value === undefined) {
    return {
      ok: true,
      value: "text_to_video"
    };
  }

  if (value === "text_to_video" || value === "image_to_video") {
    return {
      ok: true,
      value
    };
  }

  return {
    ok: false,
    error: errorResponse("invalid_video_mode", "Unsupported video generation mode.")
  };
}

function parseVideoProviderKind(value: unknown): VideoProviderKind | undefined {
  return value === "keyframe-image" || value === "custom-http" || value === "grok-imagine" ? value : undefined;
}

function parseImageProviderFormat(value: unknown): ImageProviderFormat | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return (IMAGE_PROVIDER_FORMATS as readonly string[]).includes(normalized) ? (normalized as ImageProviderFormat) : undefined;
}

function parseVideoDuration(value: unknown): ParseResult<VideoDurationPreset> {
  if (value === undefined) {
    return {
      ok: true,
      value: DEFAULT_VIDEO_DURATION_SECONDS
    };
  }

  if (typeof value === "number" && VIDEO_DURATION_PRESETS.includes(value as VideoDurationPreset)) {
    return {
      ok: true,
      value: value as VideoDurationPreset
    };
  }

  return {
    ok: false,
    error: errorResponse("invalid_video_duration", "Unsupported video duration.")
  };
}

function parseVideoAspectRatio(value: unknown): ParseResult<VideoAspectRatio> {
  if (value === undefined) {
    return {
      ok: true,
      value: "16:9"
    };
  }

  if (typeof value === "string" && VIDEO_ASPECT_RATIOS.includes(value as VideoAspectRatio)) {
    return {
      ok: true,
      value: value as VideoAspectRatio
    };
  }

  return {
    ok: false,
    error: errorResponse("invalid_video_aspect_ratio", "Unsupported video aspect ratio.")
  };
}

export function parseStorageConfigPayload(input: unknown): ParseResult<SaveStorageConfigRequest> {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_storage_config", "Storage config payload must be a JSON object.")
    };
  }

  const enabled = input.enabled === true;
  if (!enabled) {
    return {
      ok: true,
      value: {
        enabled: false,
        provider: "cos"
      }
    };
  }

  const provider = parseOptionalString(input.provider) ?? "cos";
  if (provider !== "cos") {
    return {
      ok: false,
      error: errorResponse("invalid_storage_provider", "Only Tencent COS storage is supported.")
    };
  }

  if (!isRecord(input.cos)) {
    return {
      ok: false,
      error: errorResponse("invalid_storage_config", "COS config must be a JSON object.")
    };
  }

  return {
    ok: true,
    value: {
      enabled: true,
      provider: "cos",
      cos: {
        secretId: stringValue(input.cos.secretId) ?? "",
        secretKey: stringValue(input.cos.secretKey),
        preserveSecret: input.cos.preserveSecret === true,
        bucket: stringValue(input.cos.bucket) ?? "",
        region: stringValue(input.cos.region) ?? "",
        keyPrefix: stringValue(input.cos.keyPrefix) ?? ""
      }
    }
  };
}

export function parseAgentLlmConfigPayload(input: unknown): ParseResult<SaveAgentLlmConfigRequest> {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_agent_config", "Agent LLM config payload must be a JSON object.")
    };
  }

  if (Object.hasOwn(input, "apiKey") && typeof input.apiKey !== "string") {
    return {
      ok: false,
      error: errorResponse("invalid_agent_config", "Agent LLM API key must be a string.")
    };
  }

  if (typeof input.baseUrl !== "string") {
    return {
      ok: false,
      error: errorResponse("invalid_agent_config", "Agent LLM base URL must be a string.")
    };
  }

  if (typeof input.model !== "string") {
    return {
      ok: false,
      error: errorResponse("invalid_agent_config", "Agent LLM model must be a string.")
    };
  }

  if (typeof input.timeoutMs !== "number" || !Number.isInteger(input.timeoutMs) || input.timeoutMs <= 0) {
    return {
      ok: false,
      error: errorResponse("invalid_agent_config", "Agent LLM timeout must be a positive integer.")
    };
  }

  if (typeof input.supportsVision !== "boolean") {
    return {
      ok: false,
      error: errorResponse("invalid_agent_config", "Agent LLM supportsVision must be a boolean.")
    };
  }

  return {
    ok: true,
    value: {
      apiKey: stringValue(input.apiKey),
      preserveApiKey: input.preserveApiKey === true,
      baseUrl: input.baseUrl,
      model: input.model,
      timeoutMs: input.timeoutMs,
      supportsVision: input.supportsVision
    }
  };
}

export function parseProviderConfigPayload(input: unknown): ParseResult<SaveProviderConfigRequest> {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_provider_config", "Provider config payload must be a JSON object.")
    };
  }

  const sourceOrder = parseProviderSourceOrderPayload(input.sourceOrder);
  if (!sourceOrder.ok) {
    return sourceOrder;
  }

  const video = input.video === undefined ? undefined : parseVideoProviderConfig(input.video);
  if (video && !video.ok) {
    return video;
  }

  const image = input.image === undefined ? undefined : parseLocalOpenAIProviderConfig(input.image);
  if (image && !image.ok) {
    return image;
  }

  const imageConfigs = input.imageConfigs === undefined ? undefined : parseImageProviderConfigs(input.imageConfigs);
  if (imageConfigs && !imageConfigs.ok) {
    return imageConfigs;
  }

  if (input.localOpenAI === undefined) {
    return {
      ok: true,
      value: {
        sourceOrder: sourceOrder.value,
        image: image?.value,
        imageConfigs: imageConfigs?.value,
        video: video?.value
      }
    };
  }

  const localOpenAI = parseLocalOpenAIProviderConfig(input.localOpenAI);
  if (!localOpenAI.ok) {
    return localOpenAI;
  }

  return {
    ok: true,
    value: {
      sourceOrder: sourceOrder.value,
      localOpenAI: localOpenAI.value,
      image: image?.value,
      imageConfigs: imageConfigs?.value,
      video: video?.value
    }
  };
}

function parseImageProviderConfigs(input: unknown): ParseResult<Partial<Record<ImageProviderFormat, SaveLocalOpenAIProviderConfig>>> {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_provider_config", "Image provider configs must be a JSON object.")
    };
  }

  const configs: Partial<Record<ImageProviderFormat, SaveLocalOpenAIProviderConfig>> = {};
  for (const [rawKind, rawConfig] of Object.entries(input)) {
    const kind = parseImageProviderFormat(rawKind);
    if (!kind) {
      return {
        ok: false,
        error: errorResponse("invalid_provider_config", "Image provider config key must be newapi, sub2api, or gemini.")
      };
    }

    const parsedConfig = parseLocalOpenAIProviderConfig(rawConfig);
    if (!parsedConfig.ok) {
      return parsedConfig;
    }

    configs[kind] = {
      ...parsedConfig.value,
      kind,
      imageProviderFormat: kind
    };
  }

  return {
    ok: true,
    value: configs
  };
}

function parseProviderSourceOrderPayload(input: unknown): ParseResult<ProviderSourceId[]> {
  if (!Array.isArray(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_provider_source_order", "Provider source order must be an array.")
    };
  }

  if (!isProviderSourceOrder(input)) {
    return {
      ok: false,
      error: errorResponse(
        "invalid_provider_source_order",
        `Provider source order must contain each supported source exactly once: ${PROVIDER_SOURCE_IDS.join(", ")}.`
      )
    };
  }

  return {
    ok: true,
    value: [...input]
  };
}

function parseLocalOpenAIProviderConfig(input: unknown): ParseResult<SaveLocalOpenAIProviderConfig> {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_provider_config", "Custom OpenAI config must be a JSON object.")
    };
  }

  const config: SaveLocalOpenAIProviderConfig = {
    preserveApiKey: input.preserveApiKey === true
  };

  if (Object.hasOwn(input, "apiKey")) {
    if (typeof input.apiKey !== "string") {
      return {
        ok: false,
        error: errorResponse("invalid_provider_config", "Custom OpenAI API key must be a string.")
      };
    }
    config.apiKey = input.apiKey;
  }

  if (Object.hasOwn(input, "baseUrl")) {
    if (typeof input.baseUrl !== "string") {
      return {
        ok: false,
        error: errorResponse("invalid_provider_config", "Custom OpenAI base URL must be a string.")
      };
    }
    config.baseUrl = input.baseUrl;
  }

  if (Object.hasOwn(input, "imageProviderFormat")) {
    const imageProviderFormat = parseImageProviderFormat(input.imageProviderFormat);
    if (!imageProviderFormat) {
      return {
        ok: false,
        error: errorResponse("invalid_provider_config", "Custom image provider format must be newapi, sub2api, or gemini.")
      };
    }
    config.imageProviderFormat = imageProviderFormat;
  }

  if (Object.hasOwn(input, "kind")) {
    const kind = parseImageProviderFormat(input.kind);
    if (!kind) {
      return {
        ok: false,
        error: errorResponse("invalid_provider_config", "Custom image provider kind must be newapi, sub2api, or gemini.")
      };
    }
    config.kind = kind;
  }

  if (Object.hasOwn(input, "model")) {
    if (typeof input.model !== "string") {
      return {
        ok: false,
        error: errorResponse("invalid_provider_config", "Custom OpenAI model must be a string.")
      };
    }
    config.model = input.model;
  }

  if (Object.hasOwn(input, "timeoutMs")) {
    const timeoutMs = parsePositiveIntegerValue(input.timeoutMs);
    if (!timeoutMs) {
      return {
        ok: false,
        error: errorResponse("invalid_provider_config", "Custom OpenAI timeout must be a positive integer.")
      };
    }
    config.timeoutMs = timeoutMs;
  }

  return {
    ok: true,
    value: config
  };
}

function parseVideoProviderConfig(input: unknown): ParseResult<SaveVideoProviderConfig> {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_provider_config", "Video provider config must be a JSON object.")
    };
  }

  const config: SaveVideoProviderConfig = {
    preserveApiKey: input.preserveApiKey === true
  };

  if (Object.hasOwn(input, "kind")) {
    const kind = parseVideoProviderKind(input.kind);
    if (!kind) {
      return {
        ok: false,
        error: errorResponse(
          "invalid_provider_config",
          "Video provider kind must be keyframe-image, custom-http, or grok-imagine."
        )
      };
    }
    config.kind = kind;
  }

  for (const key of [
    "apiKey",
    "baseUrl",
    "videoModel",
    "model",
    "textToVideoUrl",
    "imageToVideoUrl",
    "statusUrl",
    "ffmpegPath",
    "interpolation"
  ] as const) {
    if (!Object.hasOwn(input, key)) {
      continue;
    }
    if (typeof input[key] !== "string") {
      return {
        ok: false,
        error: errorResponse("invalid_provider_config", `Video provider ${key} must be a string.`)
      };
    }
    config[key] = input[key];
  }

  for (const key of ["timeoutMs", "pollIntervalMs", "width", "height", "fps"] as const) {
    if (!Object.hasOwn(input, key)) {
      continue;
    }
    const value = parsePositiveIntegerValue(input[key]);
    if (!value) {
      return {
        ok: false,
        error: errorResponse("invalid_provider_config", `Video provider ${key} must be a positive integer.`)
      };
    }
    config[key] = value;
  }

  return {
    ok: true,
    value: config
  };
}

function parseBaseImagePayload(input: unknown): ParseResult<ImageProviderInput> {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_request", "请求内容必须是 JSON 对象。")
    };
  }

  const prompt = input.prompt;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return {
      ok: false,
      error: errorResponse("invalid_prompt", "请输入有效的提示词。")
    };
  }

  const stylePreset = parseStylePreset(input);
  if (!stylePreset.ok) {
    return stylePreset;
  }

  const size = parseSize(input.size);
  if (!size.ok) {
    return size;
  }

  const sizePresetId = parseOptionalString(input.sizePresetId) ?? parseOptionalString(input.scenePresetId) ?? parseSizePresetFromPresetId(input.presetId);
  const resolvedSize = validateSceneImageSize({
    size: size.value,
    sizePresetId
  });

  if (!resolvedSize.ok) {
    return {
      ok: false,
      error: errorResponse(resolvedSize.code, resolvedSize.message)
    };
  }

  const quality = parseQuality(input.quality);
  if (!quality.ok) {
    return quality;
  }

  const outputFormat = parseOutputFormat(input.outputFormat);
  if (!outputFormat.ok) {
    return outputFormat;
  }

  const count = parseCount(input.count);
  if (!count.ok) {
    return count;
  }

  return {
    ok: true,
    value: {
      originalPrompt: prompt.trim(),
      presetId: stylePreset.value,
      prompt: composePrompt(prompt, stylePreset.value),
      size: resolvedSize.size,
      sizeApiValue: resolvedSize.apiValue,
      quality: quality.value,
      outputFormat: outputFormat.value,
      count: count.value
    }
  };
}

function parseStylePreset(input: Record<string, unknown>): ParseResult<StylePresetId> {
  const presetId = parseOptionalString(input.stylePresetId) ?? parseStylePresetFromPresetId(input.presetId) ?? "none";

  if (!STYLE_PRESETS.some((preset) => preset.id === presetId)) {
    return {
      ok: false,
      error: errorResponse("invalid_prompt", "不支持的风格预设。")
    };
  }

  return {
    ok: true,
    value: presetId as StylePresetId
  };
}

function parseSize(value: unknown): ParseResult<ImageSize> {
  if (!isRecord(value)) {
    return {
      ok: false,
      error: errorResponse("invalid_size", "请提供有效的图像尺寸。")
    };
  }

  return {
    ok: true,
    value: {
      width: parseDimension(value.width),
      height: parseDimension(value.height)
    }
  };
}

function parseQuality(value: unknown): ParseResult<ImageQuality> {
  if (value === undefined) {
    return {
      ok: true,
      value: "auto"
    };
  }

  if (typeof value === "string" && IMAGE_QUALITIES.includes(value as ImageQuality)) {
    return {
      ok: true,
      value: value as ImageQuality
    };
  }

  return {
    ok: false,
    error: errorResponse("invalid_request", "不支持的图像质量设置。")
  };
}

function parseOutputFormat(value: unknown): ParseResult<OutputFormat> {
  if (value === undefined) {
    return {
      ok: true,
      value: "png"
    };
  }

  if (typeof value === "string" && OUTPUT_FORMATS.includes(value as OutputFormat)) {
    return {
      ok: true,
      value: value as OutputFormat
    };
  }

  return {
    ok: false,
    error: errorResponse("invalid_request", "不支持的输出格式。")
  };
}

function parseCount(value: unknown): ParseResult<GenerationCount> {
  if (value === undefined) {
    return {
      ok: true,
      value: 1
    };
  }

  if (typeof value === "number" && GENERATION_COUNTS.includes(value as GenerationCount)) {
    return {
      ok: true,
      value: value as GenerationCount
    };
  }

  return {
    ok: false,
    error: errorResponse("invalid_request", "生成数量只能是 1、2、4、8 或 16。")
  };
}

function parseDimension(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}

function parsePositiveIntegerValue(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value.trim(), 10)
        : Number.NaN;

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Request failed.";
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function parseStylePresetFromPresetId(value: unknown): string | undefined {
  const presetId = parseOptionalString(value);
  return presetId && STYLE_PRESETS.some((preset) => preset.id === presetId) ? presetId : undefined;
}

function parseSizePresetFromPresetId(value: unknown): string | undefined {
  const presetId = parseOptionalString(value);
  return presetId && SIZE_PRESETS.some((preset) => preset.id === presetId) ? presetId : undefined;
}

export function parseProjectPayload(input: unknown):
  | {
      ok: true;
      value: ProjectPayload;
    }
  | {
      ok: false;
      error: { error: { code: string; message: string } };
    } {
  if (!isRecord(input)) {
    return {
      ok: false,
      error: errorResponse("invalid_project", "Project payload must be a JSON object.")
    };
  }

  if (!Object.hasOwn(input, "snapshot")) {
    return {
      ok: false,
      error: errorResponse("missing_snapshot", "Project payload must include a snapshot.")
    };
  }

  const snapshot = input.snapshot;
  if (snapshot !== null && (!isRecord(snapshot) || Array.isArray(snapshot))) {
    return {
      ok: false,
      error: errorResponse("invalid_snapshot", "Project snapshot must be an object or null.")
    };
  }

  const snapshotJson = JSON.stringify(snapshot);
  const snapshotBytes = snapshotJson ? Buffer.byteLength(snapshotJson, "utf8") : 0;
  if (!snapshotJson || snapshotBytes > MAX_PROJECT_SNAPSHOT_BYTES) {
    return {
      ok: false,
      error: errorResponse(
        "invalid_snapshot",
        `Project snapshot is too large (${formatBytes(snapshotBytes)}). Maximum is ${formatBytes(MAX_PROJECT_SNAPSHOT_BYTES)}.`
      )
    };
  }

  const name = input.name;
  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0 || name.length > MAX_PROJECT_NAME_LENGTH) {
      return {
        ok: false,
        error: errorResponse("invalid_name", "Project name must be a non-empty string up to 120 characters.")
      };
    }

    return {
      ok: true,
      value: {
        name: name.trim(),
        snapshotJson
      }
    };
  }

  return {
    ok: true,
    value: {
      snapshotJson
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
