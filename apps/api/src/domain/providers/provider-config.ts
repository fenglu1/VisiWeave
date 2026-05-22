import { eq } from "drizzle-orm";
import {
  IMAGE_MODEL,
  PROVIDER_SOURCE_IDS,
  type CodexAuthSessionView,
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
import { codexOAuthTokens, providerConfigs } from "../../infrastructure/schema.js";

const ACTIVE_PROVIDER_CONFIG_ID = "active";
const CODEX_TOKEN_ROW_ID = "default";
const DEFAULT_VIDEO_PROVIDER_KIND: VideoProviderKind = "keyframe-image";
const DEFAULT_VIDEO_PROVIDER_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_VIDEO_PROVIDER_POLL_INTERVAL_MS = 2_000;
const DEFAULT_KEYFRAME_VIDEO_WIDTH = 3840;
const DEFAULT_KEYFRAME_VIDEO_HEIGHT = 2160;
const DEFAULT_KEYFRAME_VIDEO_FPS = 24;
const DEFAULT_KEYFRAME_VIDEO_INTERPOLATION = "ffmpeg";

export const DEFAULT_PROVIDER_SOURCE_ORDER: ProviderSourceId[] = ["env-openai", "local-openai", "codex"];

type ProviderConfigRow = typeof providerConfigs.$inferSelect;
type CodexTokenRow = typeof codexOAuthTokens.$inferSelect;

interface ResolvedLocalConfig {
  localApiKey: string | null;
  localBaseUrl: string | null;
  localModel: string | null;
  localTimeoutMs: number | null;
}

export interface LocalVideoProviderConfig {
  kind: VideoProviderKind;
  apiKey?: string;
  baseUrl?: string;
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

interface ResolvedVideoConfig {
  videoKind: string | null;
  videoApiKey: string | null;
  videoBaseUrl: string | null;
  videoTextToVideoUrl: string | null;
  videoImageToVideoUrl: string | null;
  videoStatusUrl: string | null;
  videoTimeoutMs: number | null;
  videoPollIntervalMs: number | null;
  videoFfmpegPath: string | null;
  videoWidth: number | null;
  videoHeight: number | null;
  videoFps: number | null;
  videoInterpolation: string | null;
}

export function getProviderConfig(): ProviderConfigResponse {
  const row = getProviderConfigRow();
  const sourceOrder = readSavedSourceOrder(row?.sourceOrderJson);
  const sourcesById = new Map(providerSources(row).map((source) => [source.id, source]));
  const sources = sourceOrder.map((sourceId) => sourcesById.get(sourceId)).filter(isDefined);
  const activeSource = sources.find((source) => source.available);

  return {
    sourceOrder,
    sources,
    localOpenAI: localOpenAIConfigView(row),
    video: videoProviderConfigView(row),
    activeSource: activeSource ? providerSourceSummary(activeSource) : undefined
  };
}

export function saveProviderConfig(input: SaveProviderConfigRequest): ProviderConfigResponse {
  if (!isProviderSourceOrder(input.sourceOrder)) {
    throw new Error("Provider source order is invalid.");
  }

  const now = new Date().toISOString();
  const existing = getProviderConfigRow();
  const local = resolveLocalConfigForSave(input.localOpenAI, existing);
  const video = resolveVideoConfigForSave(input.video, existing);
  const row: ProviderConfigRow = {
    id: ACTIVE_PROVIDER_CONFIG_ID,
    sourceOrderJson: JSON.stringify(input.sourceOrder),
    localApiKey: local.localApiKey,
    localBaseUrl: local.localBaseUrl,
    localModel: local.localModel,
    localTimeoutMs: local.localTimeoutMs,
    videoKind: video.videoKind,
    videoApiKey: video.videoApiKey,
    videoBaseUrl: video.videoBaseUrl,
    videoTextToVideoUrl: video.videoTextToVideoUrl,
    videoImageToVideoUrl: video.videoImageToVideoUrl,
    videoStatusUrl: video.videoStatusUrl,
    videoTimeoutMs: video.videoTimeoutMs,
    videoPollIntervalMs: video.videoPollIntervalMs,
    videoFfmpegPath: video.videoFfmpegPath,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    videoFps: video.videoFps,
    videoInterpolation: video.videoInterpolation,
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
        localModel: row.localModel,
        localTimeoutMs: row.localTimeoutMs,
        videoKind: row.videoKind,
        videoApiKey: row.videoApiKey,
        videoBaseUrl: row.videoBaseUrl,
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
    model: getConfiguredImageModel(),
    timeoutMs: parseOpenAIImageTimeoutMs(process.env.OPENAI_IMAGE_TIMEOUT_MS)
  };
}

export function getLocalOpenAIImageProviderConfig(): OpenAIImageProviderConfig | undefined {
  const row = getProviderConfigRow();
  const apiKey = trimToUndefined(row?.localApiKey);
  if (!apiKey) {
    return undefined;
  }

  return {
    apiKey,
    baseURL: trimToUndefined(row?.localBaseUrl),
    model: trimToUndefined(row?.localModel) ?? IMAGE_MODEL,
    timeoutMs: validTimeoutMs(row?.localTimeoutMs) ?? DEFAULT_OPENAI_IMAGE_TIMEOUT_MS
  };
}

export function getLocalVideoProviderConfig(): LocalVideoProviderConfig | undefined {
  const row = getProviderConfigRow();
  if (!row || !hasLocalVideoConfig(row)) {
    return undefined;
  }

  const view = videoProviderConfigView(row, "local");
  if (view.kind === "custom-http" && !view.baseUrl && !view.textToVideoUrl && !view.imageToVideoUrl) {
    return undefined;
  }

  if (view.kind === "keyframe-image" && !process.env.OPENAI_API_KEY?.trim() && !row.videoApiKey?.trim()) {
    return undefined;
  }

  return {
    kind: view.kind,
    apiKey: trimToUndefined(row.videoApiKey),
    baseUrl: trimToUndefined(view.baseUrl),
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

function providerSources(row: ProviderConfigRow | undefined): ProviderSourceView[] {
  const envConfig = getEnvironmentOpenAIImageProviderConfig();
  const localConfig = getLocalOpenAIImageProviderConfig();
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
        model: getConfiguredImageModel(),
        timeoutMs: parseOpenAIImageTimeoutMs(process.env.OPENAI_IMAGE_TIMEOUT_MS)
      },
      secret: maskedSecret(process.env.OPENAI_API_KEY)
    },
    {
      id: "local-openai",
      kind: "local",
      label: "Custom OpenAI-compatible API",
      available: Boolean(localConfig),
      status: localConfig ? "available" : "missing_api_key",
      details: {
        baseUrl: row?.localBaseUrl ?? "",
        model: trimToUndefined(row?.localModel) ?? IMAGE_MODEL,
        timeoutMs: validTimeoutMs(row?.localTimeoutMs) ?? DEFAULT_OPENAI_IMAGE_TIMEOUT_MS
      },
      secret: maskedSecret(row?.localApiKey)
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

function localOpenAIConfigView(row: ProviderConfigRow | undefined): LocalOpenAIProviderConfigView {
  return {
    apiKey: maskedSecret(row?.localApiKey),
    baseUrl: row?.localBaseUrl ?? "",
    model: trimToUndefined(row?.localModel) ?? IMAGE_MODEL,
    timeoutMs: validTimeoutMs(row?.localTimeoutMs) ?? DEFAULT_OPENAI_IMAGE_TIMEOUT_MS
  };
}

function videoProviderConfigView(
  row: ProviderConfigRow | undefined,
  source: "environment" | "local" = videoConfigSource(row)
): VideoProviderConfigView {
  const envKind = parseVideoProviderKind(process.env.VIDEO_PROVIDER_KIND) ?? DEFAULT_VIDEO_PROVIDER_KIND;
  const kind = source === "environment" ? envKind : (parseVideoProviderKind(row?.videoKind) ?? DEFAULT_VIDEO_PROVIDER_KIND);
  const baseUrl =
    source === "environment"
      ? kind === "keyframe-image"
        ? process.env.OPENAI_BASE_URL?.trim() || ""
        : process.env.VIDEO_PROVIDER_URL?.trim() || ""
      : row?.videoBaseUrl?.trim() || "";
  const textToVideoUrl =
    source === "environment"
      ? process.env.VIDEO_PROVIDER_TEXT_TO_VIDEO_URL?.trim() || ""
      : row?.videoTextToVideoUrl?.trim() || "";
  const imageToVideoUrl =
    source === "environment"
      ? process.env.VIDEO_PROVIDER_IMAGE_TO_VIDEO_URL?.trim() || ""
      : row?.videoImageToVideoUrl?.trim() || "";
  const statusUrl =
    source === "environment"
      ? process.env.VIDEO_PROVIDER_STATUS_URL?.trim() || ""
      : row?.videoStatusUrl?.trim() || "";
  const apiKey =
    source === "environment"
      ? kind === "keyframe-image"
        ? maskedSecret(process.env.OPENAI_API_KEY)
        : maskedSecret(process.env.VIDEO_PROVIDER_API_KEY)
      : maskedSecret(row?.videoApiKey);
  const timeoutMs =
    source === "environment"
      ? positiveIntegerFromString(process.env.VIDEO_PROVIDER_TIMEOUT_MS, DEFAULT_VIDEO_PROVIDER_TIMEOUT_MS)
      : (validTimeoutMs(row?.videoTimeoutMs) ?? DEFAULT_VIDEO_PROVIDER_TIMEOUT_MS);
  const pollIntervalMs =
    source === "environment"
      ? positiveIntegerFromString(process.env.VIDEO_PROVIDER_POLL_INTERVAL_MS, DEFAULT_VIDEO_PROVIDER_POLL_INTERVAL_MS)
      : (validTimeoutMs(row?.videoPollIntervalMs) ?? DEFAULT_VIDEO_PROVIDER_POLL_INTERVAL_MS);
  const ffmpegPath =
    source === "environment"
      ? process.env.FFMPEG_PATH?.trim() || ""
      : row?.videoFfmpegPath?.trim() || "";
  const width =
    source === "environment"
      ? positiveIntegerFromString(process.env.KEYFRAME_VIDEO_WIDTH, DEFAULT_KEYFRAME_VIDEO_WIDTH)
      : (validTimeoutMs(row?.videoWidth) ?? DEFAULT_KEYFRAME_VIDEO_WIDTH);
  const height =
    source === "environment"
      ? positiveIntegerFromString(process.env.KEYFRAME_VIDEO_HEIGHT, DEFAULT_KEYFRAME_VIDEO_HEIGHT)
      : (validTimeoutMs(row?.videoHeight) ?? DEFAULT_KEYFRAME_VIDEO_HEIGHT);
  const fps =
    source === "environment"
      ? positiveIntegerFromString(process.env.KEYFRAME_VIDEO_FPS, DEFAULT_KEYFRAME_VIDEO_FPS)
      : (validTimeoutMs(row?.videoFps) ?? DEFAULT_KEYFRAME_VIDEO_FPS);
  const interpolation =
    source === "environment"
      ? process.env.KEYFRAME_VIDEO_INTERPOLATION?.trim() || DEFAULT_KEYFRAME_VIDEO_INTERPOLATION
      : row?.videoInterpolation?.trim() || DEFAULT_KEYFRAME_VIDEO_INTERPOLATION;
  const configured =
    kind === "keyframe-image"
      ? source === "environment"
        ? Boolean(process.env.OPENAI_API_KEY?.trim())
        : Boolean(row?.videoApiKey?.trim() || process.env.OPENAI_API_KEY?.trim())
      : Boolean(baseUrl || textToVideoUrl || imageToVideoUrl);

  return {
    kind,
    apiKey,
    baseUrl,
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
    supportsTextToVideo: configured && (kind === "keyframe-image" || Boolean(baseUrl || textToVideoUrl)),
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

function resolveLocalConfigForSave(
  input: SaveLocalOpenAIProviderConfig | undefined,
  existing: ProviderConfigRow | undefined
): ResolvedLocalConfig {
  if (!input) {
    return {
      localApiKey: existing?.localApiKey ?? null,
      localBaseUrl: existing?.localBaseUrl ?? null,
      localModel: existing?.localModel ?? null,
      localTimeoutMs: existing?.localTimeoutMs ?? null
    };
  }

  return {
    localApiKey: resolveLocalApiKey(input, existing),
    localBaseUrl: Object.hasOwn(input, "baseUrl") ? trimToNull(input.baseUrl) : (existing?.localBaseUrl ?? null),
    localModel: Object.hasOwn(input, "model") ? trimToNull(input.model) : (existing?.localModel ?? null),
    localTimeoutMs: Object.hasOwn(input, "timeoutMs")
      ? requiredPositiveInteger(input.timeoutMs, "Custom OpenAI timeout")
      : (existing?.localTimeoutMs ?? null)
  };
}

function resolveLocalApiKey(input: SaveLocalOpenAIProviderConfig, existing: ProviderConfigRow | undefined): string | null {
  if (typeof input.apiKey === "string") {
    const trimmed = input.apiKey.trim();
    if (trimmed) {
      return trimmed;
    }

    return input.preserveApiKey === true ? (existing?.localApiKey ?? null) : null;
  }

  return existing?.localApiKey ?? null;
}

function resolveVideoConfigForSave(
  input: SaveVideoProviderConfig | undefined,
  existing: ProviderConfigRow | undefined
): ResolvedVideoConfig {
  if (!input) {
    return {
      videoKind: existing?.videoKind ?? null,
      videoApiKey: existing?.videoApiKey ?? null,
      videoBaseUrl: existing?.videoBaseUrl ?? null,
      videoTextToVideoUrl: existing?.videoTextToVideoUrl ?? null,
      videoImageToVideoUrl: existing?.videoImageToVideoUrl ?? null,
      videoStatusUrl: existing?.videoStatusUrl ?? null,
      videoTimeoutMs: existing?.videoTimeoutMs ?? null,
      videoPollIntervalMs: existing?.videoPollIntervalMs ?? null,
      videoFfmpegPath: existing?.videoFfmpegPath ?? null,
      videoWidth: existing?.videoWidth ?? null,
      videoHeight: existing?.videoHeight ?? null,
      videoFps: existing?.videoFps ?? null,
      videoInterpolation: existing?.videoInterpolation ?? null
    };
  }

  return {
    videoKind: parseVideoProviderKind(input.kind) ?? parseVideoProviderKind(existing?.videoKind) ?? DEFAULT_VIDEO_PROVIDER_KIND,
    videoApiKey: resolveVideoApiKey(input, existing),
    videoBaseUrl: Object.hasOwn(input, "baseUrl") ? trimToNull(input.baseUrl) : (existing?.videoBaseUrl ?? null),
    videoTextToVideoUrl: Object.hasOwn(input, "textToVideoUrl")
      ? trimToNull(input.textToVideoUrl)
      : (existing?.videoTextToVideoUrl ?? null),
    videoImageToVideoUrl: Object.hasOwn(input, "imageToVideoUrl")
      ? trimToNull(input.imageToVideoUrl)
      : (existing?.videoImageToVideoUrl ?? null),
    videoStatusUrl: Object.hasOwn(input, "statusUrl") ? trimToNull(input.statusUrl) : (existing?.videoStatusUrl ?? null),
    videoTimeoutMs: Object.hasOwn(input, "timeoutMs")
      ? requiredPositiveInteger(input.timeoutMs, "Video provider timeout")
      : (existing?.videoTimeoutMs ?? null),
    videoPollIntervalMs: Object.hasOwn(input, "pollIntervalMs")
      ? requiredPositiveInteger(input.pollIntervalMs, "Video provider poll interval")
      : (existing?.videoPollIntervalMs ?? null),
    videoFfmpegPath: Object.hasOwn(input, "ffmpegPath") ? trimToNull(input.ffmpegPath) : (existing?.videoFfmpegPath ?? null),
    videoWidth: Object.hasOwn(input, "width")
      ? requiredPositiveInteger(input.width, "Keyframe video width")
      : (existing?.videoWidth ?? null),
    videoHeight: Object.hasOwn(input, "height")
      ? requiredPositiveInteger(input.height, "Keyframe video height")
      : (existing?.videoHeight ?? null),
    videoFps: Object.hasOwn(input, "fps")
      ? requiredPositiveInteger(input.fps, "Keyframe video FPS")
      : (existing?.videoFps ?? null),
    videoInterpolation: Object.hasOwn(input, "interpolation")
      ? trimToNull(input.interpolation)
      : (existing?.videoInterpolation ?? null)
  };
}

function resolveVideoApiKey(input: SaveVideoProviderConfig, existing: ProviderConfigRow | undefined): string | null {
  if (typeof input.apiKey === "string") {
    const trimmed = input.apiKey.trim();
    if (trimmed) {
      return trimmed;
    }

    return input.preserveApiKey === true ? (existing?.videoApiKey ?? null) : null;
  }

  return existing?.videoApiKey ?? null;
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
  return normalized === "keyframe-image" || normalized === "custom-http" ? normalized : undefined;
}

function videoConfigSource(row: ProviderConfigRow | undefined): "environment" | "local" {
  return hasEnvironmentVideoConfig() || !row ? "environment" : "local";
}

function hasEnvironmentVideoConfig(): boolean {
  return Boolean(
    process.env.VIDEO_PROVIDER_KIND?.trim() ||
      process.env.VIDEO_PROVIDER_URL?.trim() ||
      process.env.VIDEO_PROVIDER_TEXT_TO_VIDEO_URL?.trim() ||
      process.env.VIDEO_PROVIDER_IMAGE_TO_VIDEO_URL?.trim()
  );
}

function hasLocalVideoConfig(row: ProviderConfigRow): boolean {
  return Boolean(
    row.videoKind?.trim() ||
      row.videoApiKey?.trim() ||
      row.videoBaseUrl?.trim() ||
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

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
