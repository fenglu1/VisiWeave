export type KeyframeVideoInterpolation = "ffmpeg" | "fps";

export interface KeyframeVideoConfig {
  width: number;
  height: number;
  fps: number;
  ffmpegPath: string;
  interpolation: KeyframeVideoInterpolation;
  frameCountOverride?: number;
  keepWorkDir: boolean;
}

const DEFAULT_WIDTH = 3840;
const DEFAULT_HEIGHT = 2160;
const DEFAULT_FPS = 24;
const MIN_DIMENSION = 512;
const MAX_DIMENSION = 3840;
const MIN_FRAME_COUNT = 2;
const MAX_FRAME_COUNT = 60;
const MIN_FPS = 12;
const MAX_FPS = 60;

const DEFAULT_FRAME_COUNTS = new Map<number, number>([
  [5, 6],
  [10, 12],
  [20, 24],
  [30, 36]
]);

export function parseKeyframeVideoConfig(env: NodeJS.ProcessEnv = process.env): KeyframeVideoConfig {
  return {
    width: parseClampedInteger(env.KEYFRAME_VIDEO_WIDTH, DEFAULT_WIDTH, MIN_DIMENSION, MAX_DIMENSION),
    height: parseClampedInteger(env.KEYFRAME_VIDEO_HEIGHT, DEFAULT_HEIGHT, MIN_DIMENSION, MAX_DIMENSION),
    fps: parseClampedInteger(env.KEYFRAME_VIDEO_FPS, DEFAULT_FPS, MIN_FPS, MAX_FPS),
    ffmpegPath: env.FFMPEG_PATH?.trim() || "ffmpeg",
    interpolation: parseInterpolation(env.KEYFRAME_VIDEO_INTERPOLATION),
    frameCountOverride: parseOptionalClampedInteger(env.KEYFRAME_VIDEO_FRAME_COUNT, MIN_FRAME_COUNT, MAX_FRAME_COUNT),
    keepWorkDir: parseBoolean(env.KEYFRAME_VIDEO_KEEP_WORKDIR)
  };
}

export function keyframeVideoConfigFromValues(input: {
  width: number;
  height: number;
  fps: number;
  ffmpegPath?: string;
  interpolation?: string;
}): KeyframeVideoConfig {
  return {
    width: clampInteger(input.width, MIN_DIMENSION, MAX_DIMENSION),
    height: clampInteger(input.height, MIN_DIMENSION, MAX_DIMENSION),
    fps: clampInteger(input.fps, MIN_FPS, MAX_FPS),
    ffmpegPath: input.ffmpegPath?.trim() || "ffmpeg",
    interpolation: parseInterpolation(input.interpolation),
    keepWorkDir: false
  };
}

export function keyframeFrameCountForDuration(config: KeyframeVideoConfig, durationSeconds: number): number {
  return config.frameCountOverride ?? defaultKeyframeFrameCount(durationSeconds);
}

export function defaultKeyframeFrameCount(durationSeconds: number): number {
  const exact = DEFAULT_FRAME_COUNTS.get(durationSeconds);
  if (exact) {
    return exact;
  }

  return clampInteger(Math.round(durationSeconds * 1.2), MIN_FRAME_COUNT, MAX_FRAME_COUNT);
}

function parseInterpolation(value: string | undefined): KeyframeVideoInterpolation {
  const normalized = value?.trim().toLowerCase();
  return !normalized || normalized === "ffmpeg" ? "ffmpeg" : "fps";
}

function parseBoolean(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

function parseOptionalClampedInteger(value: string | undefined, min: number, max: number): number | undefined {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) ? clampInteger(parsed, min, max) : undefined;
}

function parseClampedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) ? clampInteger(parsed, min, max) : fallback;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
