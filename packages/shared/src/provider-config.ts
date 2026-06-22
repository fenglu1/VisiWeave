export type RuntimeImageProvider = "openai" | "codex" | "none";
export const IMAGE_PROVIDER_FORMATS = ["newapi", "sub2api", "gemini"] as const;
export type ImageProviderFormat = (typeof IMAGE_PROVIDER_FORMATS)[number];
export const GEMINI_IMAGE_MODEL_PREFERENCE_ORDER = ["openai/gpt-image-2", "seedream/seedream-5-0"] as const;
export const VIDEO_PROVIDER_KINDS = ["keyframe-image", "custom-http", "grok-imagine"] as const;
export type VideoProviderKind = (typeof VIDEO_PROVIDER_KINDS)[number];

export interface ImageProviderModelOption {
  id: string;
  displayName: string;
}

export interface ImageProviderModelsRequest {
  apiKey?: string;
  baseUrl?: string;
  kind: ImageProviderFormat;
  preserveApiKey?: boolean;
  timeoutMs?: number;
}

export interface ImageProviderModelsResponse {
  defaultModel?: string;
  kind: ImageProviderFormat;
  models: ImageProviderModelOption[];
}

export function preferredImageProviderModel(models: readonly ImageProviderModelOption[]): string | undefined {
  const modelIds = new Set(models.map((model) => model.id));
  return GEMINI_IMAGE_MODEL_PREFERENCE_ORDER.find((modelId) => modelIds.has(modelId)) ?? models[0]?.id;
}

export const PROVIDER_SOURCE_IDS = ["env-openai", "local-openai", "codex"] as const;
export type ProviderSourceId = (typeof PROVIDER_SOURCE_IDS)[number];
export type ProviderSourceKind = "environment" | "local" | "codex";
export type ProviderSourceStatus = "available" | "missing_api_key" | "missing_codex_session";

export interface MaskedSecret {
  hasSecret: boolean;
  value?: string;
}

export interface CodexAuthSessionView {
  available: boolean;
  email?: string;
  accountId?: string;
  expiresAt?: string;
  refreshedAt?: string;
  unavailableReason?: string;
}

export interface ProviderSourceDetails {
  baseUrl?: string;
  imageProviderFormat?: ImageProviderFormat;
  model?: string;
  timeoutMs?: number;
  codex?: CodexAuthSessionView;
}

export interface ProviderSourceView {
  id: ProviderSourceId;
  kind: ProviderSourceKind;
  label: string;
  available: boolean;
  status: ProviderSourceStatus;
  details: ProviderSourceDetails;
  secret: MaskedSecret;
}

export interface ProviderSourceSummary {
  id: ProviderSourceId;
  kind: ProviderSourceKind;
  label: string;
  provider: RuntimeImageProvider;
  available: boolean;
  status: ProviderSourceStatus;
}

export interface LocalOpenAIProviderConfigView {
  kind?: ImageProviderFormat;
  apiKey: MaskedSecret;
  baseUrl: string;
  imageProviderFormat: ImageProviderFormat;
  model: string;
  timeoutMs: number;
  configured?: boolean;
  source?: "local";
}

export type ImageProviderConfigView = LocalOpenAIProviderConfigView & {
  kind: ImageProviderFormat;
  configured: boolean;
  source: "local";
};

export type ImageProviderConfigMap = Record<ImageProviderFormat, ImageProviderConfigView>;

export interface VideoProviderConfigView {
  kind: VideoProviderKind;
  apiKey: MaskedSecret;
  baseUrl: string;
  videoModel: string;
  textToVideoUrl: string;
  imageToVideoUrl: string;
  statusUrl: string;
  timeoutMs: number;
  pollIntervalMs: number;
  ffmpegPath: string;
  width: number;
  height: number;
  fps: number;
  interpolation: string;
  configured: boolean;
  supportsTextToVideo: boolean;
  supportsImageToVideo: boolean;
  source: "environment" | "local";
}

export type VideoProviderConfigMap = Record<VideoProviderKind, VideoProviderConfigView>;

export interface ProviderRequestLoggingSettings {
  image: boolean;
  video: boolean;
}

export interface ProviderConfigResponse {
  sourceOrder: ProviderSourceId[];
  sources: ProviderSourceView[];
  localOpenAI: LocalOpenAIProviderConfigView;
  image: ImageProviderConfigView;
  imageConfigs: ImageProviderConfigMap;
  video: VideoProviderConfigView;
  videoConfigs: VideoProviderConfigMap;
  requestLogging: ProviderRequestLoggingSettings;
  activeSource?: ProviderSourceSummary;
}

export interface SaveLocalOpenAIProviderConfig {
  kind?: ImageProviderFormat;
  apiKey?: string;
  preserveApiKey?: boolean;
  baseUrl?: string;
  imageProviderFormat?: ImageProviderFormat;
  model?: string;
  timeoutMs?: number;
}

export interface SaveProviderConfigRequest {
  sourceOrder: ProviderSourceId[];
  localOpenAI?: SaveLocalOpenAIProviderConfig;
  image?: SaveLocalOpenAIProviderConfig;
  imageConfigs?: Partial<Record<ImageProviderFormat, SaveLocalOpenAIProviderConfig>>;
  video?: SaveVideoProviderConfig;
  requestLogging?: Partial<ProviderRequestLoggingSettings>;
}

export interface SaveVideoProviderConfig {
  kind?: VideoProviderKind;
  apiKey?: string;
  preserveApiKey?: boolean;
  baseUrl?: string;
  videoModel?: string;
  model?: string;
  textToVideoUrl?: string;
  imageToVideoUrl?: string;
  statusUrl?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  ffmpegPath?: string;
  width?: number;
  height?: number;
  fps?: number;
  interpolation?: string;
}

export interface AuthStatusResponse {
  provider: RuntimeImageProvider;
  openaiConfigured: boolean;
  codex: CodexAuthSessionView;
  activeSource?: ProviderSourceSummary;
}

export interface CodexDeviceStartResponse {
  deviceAuthId: string;
  userCode: string;
  verificationUrl: string;
  interval: number;
  expiresIn: number;
  expiresAt: string;
}

export type CodexDevicePollStatus = "authorized" | "pending" | "expired" | "denied";

export interface CodexDevicePollResponse {
  status: CodexDevicePollStatus;
  auth?: AuthStatusResponse;
  interval?: number;
  message?: string;
}

export interface CodexLogoutResponse {
  ok: true;
  auth: AuthStatusResponse;
}
