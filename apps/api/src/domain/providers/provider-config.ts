import { eq } from "drizzle-orm";
import {
  IMAGE_PROVIDER_FORMATS,
  IMAGE_MODEL,
  PROVIDER_SOURCE_IDS,
  VIDEO_PROVIDER_KINDS,
  type CodexAuthSessionView,
  type ImageProviderFormat,
  type LocalOpenAIProviderConfigView,
  type MaskedSecret,
  type ProviderConfigResponse,
  type ProviderSourceId,
  type ProviderSourceSummary,
  type ProviderSourceView,
  type RuntimeImageProvider,
  type SaveLocalOpenAIProviderConfig,
  type SaveProviderConfigRequest,
  type SaveVideoProviderConfig,
  type VideoProviderConfigMap,
  type VideoProviderConfigView,
  type VideoProviderKind
} from "../contracts.js";
import { db } from "../../infrastructure/database.js";
import {
  DEFAULT_OPENAI_IMAGE_TIMEOUT_MS,
  getConfiguredImageModel,
  parseOpenAIImageTimeoutMs,
  type OpenAIImageProviderConfig
} from "../../infrastructure/providers/image-provider.js";
import { codexOAuthTokens, imageProviderConfigs, providerConfigs, videoProviderConfigs } from "../../infrastructure/schema.js";

const ACTIVE_PROVIDER_CONFIG_ID = "active";
const CODEX_TOKEN_ROW_ID = "default";
const DEFAULT_IMAGE_PROVIDER_KIND: ImageProviderFormat = "newapi";
const DEFAULT_IMAGE_PROVIDER_MODELS: Record<ImageProviderFormat, string> = {
  newapi: IMAGE_MODEL,
  sub2api: IMAGE_MODEL,
  gemini: "gemini-2.5-flash-image"
};
const DEFAULT_VIDEO_PROVIDER_KIND: VideoProviderKind = "keyframe-image";
const DEFAULT_VIDEO_PROVIDER_MODEL = "grok-imagine-video";
const DEFAULT_VIDEO_PROVIDER_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_VIDEO_PROVIDER_POLL_INTERVAL_MS = 2_000;
const DEFAULT_KEYFRAME_VIDEO_WIDTH = 3840;
const DEFAULT_KEYFRAME_VIDEO_HEIGHT = 2160;
const DEFAULT_KEYFRAME_VIDEO_FPS = 24;
const DEFAULT_KEYFRAME_VIDEO_INTERPOLATION = "ffmpeg";

export const DEFAULT_PROVIDER_SOURCE_ORDER: ProviderSourceId[] = ["env-openai", "local-openai", "codex"];

type ProviderConfigRow = typeof providerConfigs.$inferSelect;
type ImageProviderConfigRow = typeof imageProviderConfigs.$inferSelect;
type VideoProviderConfigRow = typeof videoProviderConfigs.$inferSelect;
type CodexTokenRow = typeof codexOAuthTokens.$inferSelect;
type ImageProviderConfigRowsByKind = Partial<Record<ImageProviderFormat, ImageProviderConfigRow>>;
type VideoProviderConfigRowsByKind = Partial<Record<VideoProviderKind, VideoProviderConfigRow>>;

interface ImageProviderConfigViewForKind extends LocalOpenAIProviderConfigView {
  kind: ImageProviderFormat;
  configured: boolean;
  source: "local";
}

interface ResolvedImageProviderConfig {
  kind: ImageProviderFormat;
  apiKey: string | null;
  baseUrl: string | null;
  model: string | null;
  timeoutMs: number | null;
}

export interface LocalVideoProviderConfig {
  kind: VideoProviderKind;
  apiKey?: string;
  baseUrl?: string;
  videoModel: string;
  textToVideoUrl?: string;
  imageToVideoUrl?: string;
  statusUrl?: string;
  timeoutMs: number;
  pollIntervalMs: number;
  ffmpegPath?: string;
  width: number;
  height: number;
  fps: number;
  interpolation: string;
}

interface ResolvedVideoProviderConfig {
  kind: VideoProviderKind;
  apiKey: string | null;
  baseUrl: string | null;
  videoModel: string | null;
  textToVideoUrl: string | null;
  imageToVideoUrl: string | null;
  statusUrl: string | null;
  timeoutMs: number | null;
  pollIntervalMs: number | null;
  ffmpegPath: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  interpolation: string | null;
}

export function getProviderConfig(): ProviderConfigResponse {
  const row = getProviderConfigRow();
  const imageRows = getImageProviderConfigRowsByKind();
  const videoRows = getVideoProviderConfigRowsByKind();
  const sourceOrder = readSavedSourceOrder(row?.sourceOrderJson);
  const sourcesById = new Map(providerSources(row, imageRows).map((source) => [source.id, source]));
  const sources = sourceOrder.map((sourceId) => sourcesById.get(sourceId)).filter(isDefined);
  const activeSource = sources.find((source) => source.available);
  const image = imageProviderConfigView(row, imageRows);

  return {
    sourceOrder,
    sources,
    localOpenAI: image,
    image,
    imageConfigs: imageProviderConfigViews(row, imageRows),
    video: videoProviderConfigView(row, videoRows),
    videoConfigs: videoProviderConfigViews(videoRows),
    activeSource: activeSource ? providerSourceSummary(activeSource) : undefined
  };
}

export function saveProviderConfig(input: SaveProviderConfigRequest): ProviderConfigResponse {
  if (!isProviderSourceOrder(input.sourceOrder)) {
    throw new Error("Provider source order is invalid.");
  }

  const now = new Date().toISOString();
  const existing = getProviderConfigRow();
  const existingImageRows = getImageProviderConfigRowsByKind();
  const existingVideoRows = getVideoProviderConfigRowsByKind();
  const imageInput = input.image ?? input.localOpenAI;
  const activeImageKind = imageInput ? imageProviderKindForSave(imageInput, existing) : activeImageProviderKind(existing);
  const imageConfigs = resolveImageProviderConfigsForSave(input.imageConfigs, existingImageRows, existing);
  const pendingActiveImageConfig = imageConfigs.find((config) => config.kind === activeImageKind);
  const activeImage = imageInput
    ? resolveImageProviderConfigForSave(imageInput, activeImageKind, pendingActiveImageConfig ?? existingImageRows[activeImageKind], existing)
    : imageConfigs.find((config) => config.kind === activeImageKind);
  const activeVideoKind = input.video
    ? (parseVideoProviderKind(input.video.kind) ?? parseVideoProviderKind(existing?.videoKind) ?? DEFAULT_VIDEO_PROVIDER_KIND)
    : parseVideoProviderKind(existing?.videoKind);
  const row: ProviderConfigRow = {
    id: ACTIVE_PROVIDER_CONFIG_ID,
    sourceOrderJson: JSON.stringify(input.sourceOrder),
    localApiKey: activeImage ? activeImage.apiKey : (existing?.localApiKey ?? null),
    localBaseUrl: activeImage ? activeImage.baseUrl : (existing?.localBaseUrl ?? null),
    localImageProviderFormat: activeImage ? activeImage.kind : (existing?.localImageProviderFormat ?? null),
    localModel: activeImage ? activeImage.model : (existing?.localModel ?? null),
    localTimeoutMs: activeImage ? activeImage.timeoutMs : (existing?.localTimeoutMs ?? null),
    imageProviderKind: activeImageKind,
    videoKind: activeVideoKind ?? null,
    videoApiKey: existing?.videoApiKey ?? null,
    videoBaseUrl: existing?.videoBaseUrl ?? null,
    videoModel: existing?.videoModel ?? null,
    videoTextToVideoUrl: existing?.videoTextToVideoUrl ?? null,
    videoImageToVideoUrl: existing?.videoImageToVideoUrl ?? null,
    videoStatusUrl: existing?.videoStatusUrl ?? null,
    videoTimeoutMs: existing?.videoTimeoutMs ?? null,
    videoPollIntervalMs: existing?.videoPollIntervalMs ?? null,
    videoFfmpegPath: existing?.videoFfmpegPath ?? null,
    videoWidth: existing?.videoWidth ?? null,
    videoHeight: existing?.videoHeight ?? null,
    videoFps: existing?.videoFps ?? null,
    videoInterpolation: existing?.videoInterpolation ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  db.insert(providerConfigs)
    .values(row)
    .onConflictDoUpdate({
      target: providerConfigs.id,
      set: {
        sourceOrderJson: row.sourceOrderJson,
        localApiKey: row.localApiKey,
        localBaseUrl: row.localBaseUrl,
        localImageProviderFormat: row.localImageProviderFormat,
        localModel: row.localModel,
        localTimeoutMs: row.localTimeoutMs,
        imageProviderKind: row.imageProviderKind,
        videoKind: row.videoKind,
        videoApiKey: row.videoApiKey,
        videoBaseUrl: row.videoBaseUrl,
        videoModel: row.videoModel,
        videoTextToVideoUrl: row.videoTextToVideoUrl,
        videoImageToVideoUrl: row.videoImageToVideoUrl,
        videoStatusUrl: row.videoStatusUrl,
        videoTimeoutMs: row.videoTimeoutMs,
        videoPollIntervalMs: row.videoPollIntervalMs,
        videoFfmpegPath: row.videoFfmpegPath,
        videoWidth: row.videoWidth,
        videoHeight: row.videoHeight,
        videoFps: row.videoFps,
        videoInterpolation: row.videoInterpolation,
        updatedAt: row.updatedAt
      }
    })
    .run();

  for (const imageConfig of dedupeImageProviderConfigs([...imageConfigs, ...(activeImage ? [activeImage] : [])])) {
    saveImageProviderConfigForKind(imageConfig, now);
  }

  if (input.video) {
    const videoKindForSave = activeVideoKind ?? DEFAULT_VIDEO_PROVIDER_KIND;
    saveVideoProviderConfigForKind(
      resolveVideoProviderConfigForSave(input.video, videoKindForSave, existingVideoRows[videoKindForSave]),
      now
    );
  }

  return getProviderConfig();
}

export function getProviderSourceOrder(): ProviderSourceId[] {
  return readSavedSourceOrder(getProviderConfigRow()?.sourceOrderJson);
}

export function getEnvironmentOpenAIImageProviderConfig(): OpenAIImageProviderConfig | undefined {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return undefined;
  }

  const baseURL = process.env.OPENAI_BASE_URL?.trim();
  return {
    apiKey,
    baseURL: baseURL || undefined,
    imageProviderFormat: parseImageProviderFormat(process.env.OPENAI_IMAGE_PROVIDER_FORMAT) ?? "newapi",
    model: getConfiguredImageModel(),
    timeoutMs: parseOpenAIImageTimeoutMs(process.env.OPENAI_IMAGE_TIMEOUT_MS)
  };
}

export function getLocalOpenAIImageProviderConfig(): OpenAIImageProviderConfig | undefined {
  const row = getProviderConfigRow();
  const imageRows = getImageProviderConfigRowsByKind();
  const kind = activeImageProviderKind(row);
  const imageRow = imageProviderConfigRowForKind(kind, row, imageRows);
  const apiKey = trimToUndefined(imageRow.apiKey);
  if (!apiKey) {
    return undefined;
  }

  return {
    apiKey,
    baseURL: trimToUndefined(imageRow.baseUrl),
    imageProviderFormat: kind,
    model: trimToUndefined(imageRow.model) ?? defaultImageModel(kind),
    timeoutMs: validTimeoutMs(imageRow.timeoutMs) ?? DEFAULT_OPENAI_IMAGE_TIMEOUT_MS
  };
}

export function getLocalVideoProviderConfig(kindOverride?: VideoProviderKind): LocalVideoProviderConfig | undefined {
  const row = getProviderConfigRow();
  const videoRows = getVideoProviderConfigRowsByKind();
  if (!row || !hasLocalVideoConfig(row, videoRows)) {
    return undefined;
  }

  const requestedKind = kindOverride ?? parseVideoProviderKind(row.videoKind) ?? DEFAULT_VIDEO_PROVIDER_KIND;
  const view = videoProviderConfigViewForKind(requestedKind, videoRows[requestedKind], "local");
  const videoRow = videoRows[view.kind];
  return {
    kind: view.kind,
    apiKey: trimToUndefined(videoRow?.apiKey),
    baseUrl: trimToUndefined(view.baseUrl),
    videoModel: view.videoModel,
    textToVideoUrl: trimToUndefined(view.textToVideoUrl),
    imageToVideoUrl: trimToUndefined(view.imageToVideoUrl),
    statusUrl: trimToUndefined(view.statusUrl),
    timeoutMs: view.timeoutMs,
    pollIntervalMs: view.pollIntervalMs,
    ffmpegPath: trimToUndefined(view.ffmpegPath),
    width: view.width,
    height: view.height,
    fps: view.fps,
    interpolation: view.interpolation
  };
}

export function isProviderSourceOrder(value: unknown): value is ProviderSourceId[] {
  return parseProviderSourceOrder(value) !== undefined;
}

export function isProviderSourceId(value: unknown): value is ProviderSourceId {
  return typeof value === "string" && (PROVIDER_SOURCE_IDS as readonly string[]).includes(value);
}

function getProviderConfigRow(): ProviderConfigRow | undefined {
  return db.select().from(providerConfigs).where(eq(providerConfigs.id, ACTIVE_PROVIDER_CONFIG_ID)).get();
}

function getImageProviderConfigRowsByKind(): ImageProviderConfigRowsByKind {
  const rows = db.select().from(imageProviderConfigs).all();
  const byKind: ImageProviderConfigRowsByKind = {};

  for (const row of rows) {
    const kind = parseImageProviderFormat(row.kind);
    if (kind) {
      byKind[kind] = row;
    }
  }

  return byKind;
}

function getVideoProviderConfigRowsByKind(): VideoProviderConfigRowsByKind {
  const rows = db.select().from(videoProviderConfigs).all();
  const byKind: VideoProviderConfigRowsByKind = {};

  for (const row of rows) {
    const kind = parseVideoProviderKind(row.kind);
    if (kind) {
      byKind[kind] = row;
    }
  }

  return byKind;
}

function providerSources(row: ProviderConfigRow | undefined, imageRows: ImageProviderConfigRowsByKind): ProviderSourceView[] {
  const envConfig = getEnvironmentOpenAIImageProviderConfig();
  const localConfig = imageProviderConfigView(row, imageRows);
  const codex = codexSessionView(getCodexTokenRow());

  return [
    {
      id: "env-openai",
      kind: "environment",
      label: "Environment OpenAI API",
      available: Boolean(envConfig),
      status: envConfig ? "available" : "missing_api_key",
      details: {
        baseUrl: process.env.OPENAI_BASE_URL?.trim() || "",
        imageProviderFormat: parseImageProviderFormat(process.env.OPENAI_IMAGE_PROVIDER_FORMAT) ?? "newapi",
        model: getConfiguredImageModel(),
        timeoutMs: parseOpenAIImageTimeoutMs(process.env.OPENAI_IMAGE_TIMEOUT_MS)
      },
      secret: maskedSecret(process.env.OPENAI_API_KEY)
    },
    {
      id: "local-openai",
      kind: "local",
      label: "Custom OpenAI-compatible API",
      available: localConfig.configured,
      status: localConfig.configured ? "available" : "missing_api_key",
      details: {
        baseUrl: localConfig.baseUrl,
        imageProviderFormat: localConfig.imageProviderFormat,
        model: localConfig.model,
        timeoutMs: localConfig.timeoutMs
      },
      secret: localConfig.apiKey
    },
    {
      id: "codex",
      kind: "codex",
      label: "Codex",
      available: codex.available,
      status: codex.available ? "available" : "missing_codex_session",
      details: {
        codex
      },
      secret: {
        hasSecret: false
      }
    }
  ];
}

function imageProviderConfigView(
  row: ProviderConfigRow | undefined,
  imageRows: ImageProviderConfigRowsByKind
): ImageProviderConfigViewForKind {
  const kind = activeImageProviderKind(row);
  return imageProviderConfigViewForKind(kind, row, imageRows);
}

function imageProviderConfigViews(
  row: ProviderConfigRow | undefined,
  imageRows: ImageProviderConfigRowsByKind
): Record<ImageProviderFormat, ImageProviderConfigViewForKind> {
  return {
    newapi: imageProviderConfigViewForKind("newapi", row, imageRows),
    sub2api: imageProviderConfigViewForKind("sub2api", row, imageRows),
    gemini: imageProviderConfigViewForKind("gemini", row, imageRows)
  };
}

function imageProviderConfigViewForKind(
  kind: ImageProviderFormat,
  providerRow: ProviderConfigRow | undefined,
  imageRows: ImageProviderConfigRowsByKind
): ImageProviderConfigViewForKind {
  const row = imageProviderConfigRowForKind(kind, providerRow, imageRows);
  const apiKey = row.apiKey?.trim() || "";
  return {
    kind,
    apiKey: maskedSecret(apiKey),
    baseUrl: row.baseUrl?.trim() || "",
    imageProviderFormat: kind,
    model: row.model?.trim() || defaultImageModel(kind),
    timeoutMs: validTimeoutMs(row.timeoutMs) ?? DEFAULT_OPENAI_IMAGE_TIMEOUT_MS,
    configured: Boolean(apiKey),
    source: "local"
  };
}

function activeImageProviderKind(row: ProviderConfigRow | undefined): ImageProviderFormat {
  return parseImageProviderFormat(row?.imageProviderKind) ?? parseImageProviderFormat(row?.localImageProviderFormat) ?? DEFAULT_IMAGE_PROVIDER_KIND;
}

function imageProviderConfigRowForKind(
  kind: ImageProviderFormat,
  providerRow: ProviderConfigRow | undefined,
  imageRows: ImageProviderConfigRowsByKind
): Pick<ImageProviderConfigRow, "apiKey" | "baseUrl" | "model" | "timeoutMs"> {
  return imageRows[kind] ?? legacyImageProviderConfigRowForKind(kind, providerRow);
}

function legacyImageProviderConfigRowForKind(
  kind: ImageProviderFormat,
  row: ProviderConfigRow | undefined
): Pick<ImageProviderConfigRow, "apiKey" | "baseUrl" | "model" | "timeoutMs"> {
  if (kind !== activeImageProviderKind(row)) {
    return {
      apiKey: null,
      baseUrl: null,
      model: null,
      timeoutMs: null
    };
  }

  return {
    apiKey: row?.localApiKey ?? null,
    baseUrl: row?.localBaseUrl ?? null,
    model: row?.localModel ?? null,
    timeoutMs: row?.localTimeoutMs ?? null
  };
}

function defaultImageModel(kind: ImageProviderFormat): string {
  return DEFAULT_IMAGE_PROVIDER_MODELS[kind];
}

function videoProviderConfigView(
  row: ProviderConfigRow | undefined,
  videoRows: VideoProviderConfigRowsByKind,
  source: "environment" | "local" = videoConfigSource(row, videoRows)
): VideoProviderConfigView {
  const envKind = parseVideoProviderKind(process.env.VIDEO_PROVIDER_KIND) ?? DEFAULT_VIDEO_PROVIDER_KIND;
  const kind = source === "environment" ? envKind : (parseVideoProviderKind(row?.videoKind) ?? DEFAULT_VIDEO_PROVIDER_KIND);
  return videoProviderConfigViewForKind(kind, videoRows[kind], source);
}

function videoProviderConfigViews(videoRows: VideoProviderConfigRowsByKind): VideoProviderConfigMap {
  return {
    "keyframe-image": videoProviderConfigViewForKind("keyframe-image", videoRows["keyframe-image"], "local"),
    "custom-http": videoProviderConfigViewForKind("custom-http", videoRows["custom-http"], "local"),
    "grok-imagine": videoProviderConfigViewForKind("grok-imagine", videoRows["grok-imagine"], "local")
  };
}

function videoProviderConfigViewForKind(
  kind: VideoProviderKind,
  row: VideoProviderConfigRow | undefined,
  source: "environment" | "local"
): VideoProviderConfigView {
  const baseUrl =
    source === "environment"
      ? kind === "keyframe-image"
        ? process.env.OPENAI_BASE_URL?.trim() || ""
        : process.env.VIDEO_PROVIDER_URL?.trim() || ""
      : row?.baseUrl?.trim() || "";
  const textToVideoUrl =
    source === "environment"
      ? process.env.VIDEO_PROVIDER_TEXT_TO_VIDEO_URL?.trim() || ""
      : row?.textToVideoUrl?.trim() || "";
  const imageToVideoUrl =
    source === "environment"
      ? process.env.VIDEO_PROVIDER_IMAGE_TO_VIDEO_URL?.trim() || ""
      : row?.imageToVideoUrl?.trim() || "";
  const statusUrl =
    source === "environment"
      ? process.env.VIDEO_PROVIDER_STATUS_URL?.trim() || ""
      : row?.statusUrl?.trim() || "";
  const apiKey =
    source === "environment"
      ? kind === "keyframe-image"
        ? maskedSecret(process.env.OPENAI_API_KEY)
        : maskedSecret(process.env.VIDEO_PROVIDER_API_KEY)
      : maskedSecret(row?.apiKey);
  const videoModel =
    source === "environment"
      ? process.env.VIDEO_PROVIDER_MODEL?.trim() || DEFAULT_VIDEO_PROVIDER_MODEL
      : row?.videoModel?.trim() || DEFAULT_VIDEO_PROVIDER_MODEL;
  const timeoutMs =
    source === "environment"
      ? positiveIntegerFromString(process.env.VIDEO_PROVIDER_TIMEOUT_MS, DEFAULT_VIDEO_PROVIDER_TIMEOUT_MS)
      : (validTimeoutMs(row?.timeoutMs) ?? DEFAULT_VIDEO_PROVIDER_TIMEOUT_MS);
  const pollIntervalMs =
    source === "environment"
      ? positiveIntegerFromString(process.env.VIDEO_PROVIDER_POLL_INTERVAL_MS, DEFAULT_VIDEO_PROVIDER_POLL_INTERVAL_MS)
      : (validTimeoutMs(row?.pollIntervalMs) ?? DEFAULT_VIDEO_PROVIDER_POLL_INTERVAL_MS);
  const ffmpegPath =
    source === "environment"
      ? process.env.FFMPEG_PATH?.trim() || ""
      : row?.ffmpegPath?.trim() || "";
  const width =
    source === "environment"
      ? positiveIntegerFromString(process.env.KEYFRAME_VIDEO_WIDTH, DEFAULT_KEYFRAME_VIDEO_WIDTH)
      : (validTimeoutMs(row?.width) ?? DEFAULT_KEYFRAME_VIDEO_WIDTH);
  const height =
    source === "environment"
      ? positiveIntegerFromString(process.env.KEYFRAME_VIDEO_HEIGHT, DEFAULT_KEYFRAME_VIDEO_HEIGHT)
      : (validTimeoutMs(row?.height) ?? DEFAULT_KEYFRAME_VIDEO_HEIGHT);
  const fps =
    source === "environment"
      ? positiveIntegerFromString(process.env.KEYFRAME_VIDEO_FPS, DEFAULT_KEYFRAME_VIDEO_FPS)
      : (validTimeoutMs(row?.fps) ?? DEFAULT_KEYFRAME_VIDEO_FPS);
  const interpolation =
    source === "environment"
      ? process.env.KEYFRAME_VIDEO_INTERPOLATION?.trim() || DEFAULT_KEYFRAME_VIDEO_INTERPOLATION
      : row?.interpolation?.trim() || DEFAULT_KEYFRAME_VIDEO_INTERPOLATION;
  const configured =
    kind === "keyframe-image"
      ? source === "environment"
        ? Boolean(process.env.OPENAI_API_KEY?.trim())
        : Boolean(row?.apiKey?.trim() || process.env.OPENAI_API_KEY?.trim())
      : kind === "grok-imagine"
        ? source === "environment"
        ? Boolean(process.env.VIDEO_PROVIDER_API_KEY?.trim() && baseUrl)
          : Boolean(row?.apiKey?.trim() && baseUrl)
        : Boolean(baseUrl || textToVideoUrl || imageToVideoUrl);

  return {
    kind,
    apiKey,
    baseUrl,
    videoModel,
    textToVideoUrl,
    imageToVideoUrl,
    statusUrl,
    timeoutMs,
    pollIntervalMs,
    ffmpegPath,
    width,
    height,
    fps,
    interpolation,
    configured,
    supportsTextToVideo: configured && (kind === "keyframe-image" || kind === "grok-imagine" || Boolean(baseUrl || textToVideoUrl)),
    supportsImageToVideo: configured && kind === "custom-http" && Boolean(baseUrl || imageToVideoUrl),
    source
  };
}

function providerSourceSummary(source: ProviderSourceView): ProviderSourceSummary {
  return {
    id: source.id,
    kind: source.kind,
    label: source.label,
    provider: runtimeProviderForSource(source.id),
    available: source.available,
    status: source.status
  };
}

function runtimeProviderForSource(sourceId: ProviderSourceId): RuntimeImageProvider {
  if (sourceId === "codex") {
    return "codex";
  }

  return "openai";
}

function imageProviderKindForSave(input: SaveLocalOpenAIProviderConfig, existing: ProviderConfigRow | undefined): ImageProviderFormat {
  return parseImageProviderFormat(input.kind) ?? parseImageProviderFormat(input.imageProviderFormat) ?? activeImageProviderKind(existing);
}

function resolveImageProviderConfigsForSave(
  inputs: SaveProviderConfigRequest["imageConfigs"],
  existingRows: ImageProviderConfigRowsByKind,
  legacy: ProviderConfigRow | undefined
): ResolvedImageProviderConfig[] {
  if (!inputs) {
    return [];
  }

  return IMAGE_PROVIDER_FORMATS.flatMap((kind) => {
    const input = inputs[kind];
    if (!input) {
      return [];
    }

    return [
      resolveImageProviderConfigForSave(
        {
          ...input,
          kind,
          imageProviderFormat: kind
        },
        kind,
        existingRows[kind],
        legacy
      )
    ];
  });
}

function dedupeImageProviderConfigs(configs: ResolvedImageProviderConfig[]): ResolvedImageProviderConfig[] {
  const byKind = new Map<ImageProviderFormat, ResolvedImageProviderConfig>();
  for (const config of configs) {
    byKind.set(config.kind, config);
  }
  return [...byKind.values()];
}

function resolveImageProviderConfigForSave(
  input: SaveLocalOpenAIProviderConfig,
  kind: ImageProviderFormat,
  existing: Pick<ImageProviderConfigRow, "apiKey" | "baseUrl" | "model" | "timeoutMs"> | undefined,
  legacy: ProviderConfigRow | undefined
): ResolvedImageProviderConfig {
  const existingForKind = existing ?? legacyImageProviderConfigRowForKind(kind, legacy);
  return {
    kind,
    apiKey: resolveImageApiKey(input, existingForKind),
    baseUrl: Object.hasOwn(input, "baseUrl") ? trimToNull(input.baseUrl) : (existingForKind.baseUrl ?? null),
    model: Object.hasOwn(input, "model") ? trimToNull(input.model) : (existingForKind.model ?? null),
    timeoutMs: Object.hasOwn(input, "timeoutMs")
      ? requiredPositiveInteger(input.timeoutMs, "Custom image provider timeout")
      : (existingForKind.timeoutMs ?? null)
  };
}

function saveImageProviderConfigForKind(config: ResolvedImageProviderConfig, now: string): void {
  const row: ImageProviderConfigRow = {
    kind: config.kind,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    timeoutMs: config.timeoutMs,
    createdAt: now,
    updatedAt: now
  };

  db.insert(imageProviderConfigs)
    .values(row)
    .onConflictDoUpdate({
      target: imageProviderConfigs.kind,
      set: {
        apiKey: row.apiKey,
        baseUrl: row.baseUrl,
        model: row.model,
        timeoutMs: row.timeoutMs,
        updatedAt: row.updatedAt
      }
    })
    .run();
}

function resolveImageApiKey(
  input: SaveLocalOpenAIProviderConfig,
  existing: Pick<ImageProviderConfigRow, "apiKey"> | undefined
): string | null {
  if (typeof input.apiKey === "string") {
    const trimmed = input.apiKey.trim();
    if (trimmed) {
      return trimmed;
    }

    return input.preserveApiKey === true ? (existing?.apiKey ?? null) : null;
  }

  return existing?.apiKey ?? null;
}

function resolveVideoProviderConfigForSave(
  input: SaveVideoProviderConfig,
  kind: VideoProviderKind,
  existing: VideoProviderConfigRow | undefined
): ResolvedVideoProviderConfig {
  return {
    kind,
    apiKey: resolveVideoApiKey(input, existing),
    baseUrl: Object.hasOwn(input, "baseUrl") ? trimToNull(input.baseUrl) : (existing?.baseUrl ?? null),
    videoModel:
      Object.hasOwn(input, "videoModel") || Object.hasOwn(input, "model")
        ? trimToNull(input.videoModel ?? input.model)
        : (existing?.videoModel ?? null),
    textToVideoUrl: Object.hasOwn(input, "textToVideoUrl") ? trimToNull(input.textToVideoUrl) : (existing?.textToVideoUrl ?? null),
    imageToVideoUrl: Object.hasOwn(input, "imageToVideoUrl") ? trimToNull(input.imageToVideoUrl) : (existing?.imageToVideoUrl ?? null),
    statusUrl: Object.hasOwn(input, "statusUrl") ? trimToNull(input.statusUrl) : (existing?.statusUrl ?? null),
    timeoutMs: Object.hasOwn(input, "timeoutMs")
      ? requiredPositiveInteger(input.timeoutMs, "Video provider timeout")
      : (existing?.timeoutMs ?? null),
    pollIntervalMs: Object.hasOwn(input, "pollIntervalMs")
      ? requiredPositiveInteger(input.pollIntervalMs, "Video provider poll interval")
      : (existing?.pollIntervalMs ?? null),
    ffmpegPath: Object.hasOwn(input, "ffmpegPath") ? trimToNull(input.ffmpegPath) : (existing?.ffmpegPath ?? null),
    width: Object.hasOwn(input, "width")
      ? requiredPositiveInteger(input.width, "Keyframe video width")
      : (existing?.width ?? null),
    height: Object.hasOwn(input, "height")
      ? requiredPositiveInteger(input.height, "Keyframe video height")
      : (existing?.height ?? null),
    fps: Object.hasOwn(input, "fps")
      ? requiredPositiveInteger(input.fps, "Keyframe video FPS")
      : (existing?.fps ?? null),
    interpolation: Object.hasOwn(input, "interpolation") ? trimToNull(input.interpolation) : (existing?.interpolation ?? null)
  };
}

function saveVideoProviderConfigForKind(config: ResolvedVideoProviderConfig, now: string): void {
  const row: VideoProviderConfigRow = {
    kind: config.kind,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    videoModel: config.videoModel,
    textToVideoUrl: config.textToVideoUrl,
    imageToVideoUrl: config.imageToVideoUrl,
    statusUrl: config.statusUrl,
    timeoutMs: config.timeoutMs,
    pollIntervalMs: config.pollIntervalMs,
    ffmpegPath: config.ffmpegPath,
    width: config.width,
    height: config.height,
    fps: config.fps,
    interpolation: config.interpolation,
    createdAt: now,
    updatedAt: now
  };

  db.insert(videoProviderConfigs)
    .values(row)
    .onConflictDoUpdate({
      target: videoProviderConfigs.kind,
      set: {
        apiKey: row.apiKey,
        baseUrl: row.baseUrl,
        videoModel: row.videoModel,
        textToVideoUrl: row.textToVideoUrl,
        imageToVideoUrl: row.imageToVideoUrl,
        statusUrl: row.statusUrl,
        timeoutMs: row.timeoutMs,
        pollIntervalMs: row.pollIntervalMs,
        ffmpegPath: row.ffmpegPath,
        width: row.width,
        height: row.height,
        fps: row.fps,
        interpolation: row.interpolation,
        updatedAt: row.updatedAt
      }
    })
    .run();
}

function resolveVideoApiKey(input: SaveVideoProviderConfig, existing: VideoProviderConfigRow | undefined): string | null {
  if (typeof input.apiKey === "string") {
    const trimmed = input.apiKey.trim();
    if (trimmed) {
      return trimmed;
    }

    return input.preserveApiKey === true ? (existing?.apiKey ?? null) : null;
  }

  return existing?.apiKey ?? null;
}

function requiredPositiveInteger(value: number | undefined, label: string): number | null {
  if (value === undefined) {
    return null;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return value;
}

function readSavedSourceOrder(value: string | undefined): ProviderSourceId[] {
  if (!value) {
    return [...DEFAULT_PROVIDER_SOURCE_ORDER];
  }

  try {
    return parseProviderSourceOrder(JSON.parse(value) as unknown) ?? [...DEFAULT_PROVIDER_SOURCE_ORDER];
  } catch {
    return [...DEFAULT_PROVIDER_SOURCE_ORDER];
  }
}

function parseProviderSourceOrder(value: unknown): ProviderSourceId[] | undefined {
  if (!Array.isArray(value) || value.length !== PROVIDER_SOURCE_IDS.length) {
    return undefined;
  }

  if (!value.every(isProviderSourceId)) {
    return undefined;
  }

  const unique = new Set(value);
  if (unique.size !== PROVIDER_SOURCE_IDS.length) {
    return undefined;
  }

  return PROVIDER_SOURCE_IDS.every((sourceId) => unique.has(sourceId)) ? [...value] : undefined;
}

function getCodexTokenRow(): CodexTokenRow | undefined {
  return db.select().from(codexOAuthTokens).where(eq(codexOAuthTokens.id, CODEX_TOKEN_ROW_ID)).get();
}

function codexSessionView(row: CodexTokenRow | undefined): CodexAuthSessionView {
  const available = hasUsableTokenMaterial(row);

  return {
    available,
    email: row?.email ?? undefined,
    accountId: row?.accountId ?? undefined,
    expiresAt: row?.expiresAt ?? undefined,
    refreshedAt: row?.refreshedAt ?? undefined,
    unavailableReason: !available ? (row?.unavailableReason ?? undefined) : undefined
  };
}

function hasUsableTokenMaterial(row: CodexTokenRow | undefined): row is CodexTokenRow & {
  accessToken: string;
  refreshToken: string;
} {
  return Boolean(row?.accessToken?.trim() && row.refreshToken?.trim() && !row.unavailableAt);
}

function maskedSecret(value: string | null | undefined): MaskedSecret {
  const trimmed = trimToUndefined(value);
  return {
    hasSecret: Boolean(trimmed),
    value: trimmed ? maskSecret(trimmed) : undefined
  };
}

function maskSecret(value: string): string {
  if (value.length <= 8) {
    return "*".repeat(value.length);
  }

  return `${value.slice(0, 4)}${"*".repeat(Math.min(8, Math.max(4, value.length - 8)))}${value.slice(-4)}`;
}

function trimToUndefined(value: string | null | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function trimToNull(value: string | undefined): string | null {
  return value?.trim() || null;
}

function validTimeoutMs(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function positiveIntegerFromString(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseVideoProviderKind(value: string | null | undefined): VideoProviderKind | undefined {
  const normalized = value?.trim();
  return normalized === "keyframe-image" || normalized === "custom-http" || normalized === "grok-imagine"
    ? normalized
    : undefined;
}

function parseImageProviderFormat(value: unknown): ImageProviderFormat | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return (IMAGE_PROVIDER_FORMATS as readonly string[]).includes(normalized) ? (normalized as ImageProviderFormat) : undefined;
}

function videoConfigSource(
  row: ProviderConfigRow | undefined,
  videoRows: VideoProviderConfigRowsByKind
): "environment" | "local" {
  if (row && hasLocalVideoConfig(row, videoRows)) {
    return "local";
  }

  return "environment";
}

function hasEnvironmentVideoConfig(): boolean {
  return Boolean(
    process.env.VIDEO_PROVIDER_KIND?.trim() ||
      process.env.VIDEO_PROVIDER_URL?.trim() ||
      process.env.VIDEO_PROVIDER_MODEL?.trim() ||
      process.env.VIDEO_PROVIDER_TEXT_TO_VIDEO_URL?.trim() ||
      process.env.VIDEO_PROVIDER_IMAGE_TO_VIDEO_URL?.trim()
  );
}

function hasLocalVideoConfig(row: ProviderConfigRow, videoRows: VideoProviderConfigRowsByKind): boolean {
  const activeKind = parseVideoProviderKind(row.videoKind);
  if (activeKind && hasLocalVideoProviderRowConfig(videoRows[activeKind])) {
    return true;
  }

  return Boolean(
    row.videoApiKey?.trim() ||
      row.videoBaseUrl?.trim() ||
      row.videoModel?.trim() ||
      row.videoTextToVideoUrl?.trim() ||
      row.videoImageToVideoUrl?.trim() ||
      row.videoStatusUrl?.trim() ||
      row.videoFfmpegPath?.trim() ||
      row.videoTimeoutMs ||
      row.videoPollIntervalMs ||
      row.videoWidth ||
      row.videoHeight ||
      row.videoFps ||
      row.videoInterpolation?.trim()
  );
}

function hasLocalVideoProviderRowConfig(row: VideoProviderConfigRow | undefined): boolean {
  return Boolean(
    row?.apiKey?.trim() ||
      row?.baseUrl?.trim() ||
      row?.videoModel?.trim() ||
      row?.textToVideoUrl?.trim() ||
      row?.imageToVideoUrl?.trim() ||
      row?.statusUrl?.trim() ||
      row?.ffmpegPath?.trim() ||
      row?.timeoutMs ||
      row?.pollIntervalMs ||
      row?.width ||
      row?.height ||
      row?.fps ||
      row?.interpolation?.trim()
  );
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
