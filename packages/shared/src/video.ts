export type VideoGenerationMode = "text_to_video" | "image_to_video";
export type VideoGenerationStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type VideoGenerationProgressStage =
  | "queued"
  | "running"
  | "saving"
  | "succeeded"
  | "failed"
  | "preparing"
  | "generating_keyframes"
  | "composing_video";

export const VIDEO_DURATION_PRESETS = [5, 10, 20, 30] as const;
export type VideoDurationPreset = (typeof VIDEO_DURATION_PRESETS)[number];
export const DEFAULT_VIDEO_DURATION_SECONDS = 10 as const;

export const VIDEO_ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;
export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number];

export interface GenerateVideoRequest {
  prompt: string;
  mode: VideoGenerationMode;
  durationSeconds: VideoDurationPreset;
  aspectRatio: VideoAspectRatio;
  referenceAssetId?: string;
}

export interface VideoAsset {
  id: string;
  url: string;
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
  durationSeconds: number;
}

export interface VideoGenerationOutput {
  id: string;
  status: VideoGenerationStatus;
  asset?: VideoAsset;
  error?: string;
  createdAt: string;
}

export interface VideoGenerationJob {
  id: string;
  mode: VideoGenerationMode;
  prompt: string;
  effectivePrompt: string;
  durationSeconds: number;
  aspectRatio: VideoAspectRatio;
  size: {
    width: number;
    height: number;
  };
  provider: string;
  status: VideoGenerationStatus;
  progressPercent: number;
  progressStage: VideoGenerationProgressStage | string;
  progressMessage?: string;
  error?: string;
  referenceAssetId?: string;
  createdAt: string;
  updatedAt: string;
  outputs: VideoGenerationOutput[];
}

export interface VideoGenerationJobResponse {
  job: VideoGenerationJob;
}

export interface VideoProviderStatus {
  id: string;
  configured: boolean;
  supportsTextToVideo: boolean;
  supportsImageToVideo: boolean;
  message?: string;
}

export interface VideoProviderStatusResponse {
  provider: VideoProviderStatus;
}

export interface VideoLibraryItem {
  outputId: string;
  generationId: string;
  mode: VideoGenerationMode;
  prompt: string;
  effectivePrompt: string;
  durationSeconds: number;
  aspectRatio: VideoAspectRatio;
  size: {
    width: number;
    height: number;
  };
  provider: string;
  status: VideoGenerationStatus;
  progressPercent: number;
  progressStage: VideoGenerationProgressStage | string;
  progressMessage?: string;
  error?: string;
  referenceAssetId?: string;
  createdAt: string;
  asset?: VideoAsset;
}

export interface VideoLibraryResponse {
  items: VideoLibraryItem[];
}

export interface VideoBatchDeleteRequest {
  outputIds: string[];
}

export interface VideoBatchDeleteResponse {
  deletedIds: string[];
  notFoundIds: string[];
  skippedIds: string[];
  failedIds: string[];
}
