import { spawn } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { KeyframeVideoConfig } from "./config.js";
import { KeyframeVideoError, sanitizeKeyframeVideoErrorMessage } from "./errors.js";
import type { GeneratedKeyframeImage } from "./image-frames.js";

interface ComposeKeyframeVideoInput {
  frames: GeneratedKeyframeImage[];
  workDir: string;
  outputPath: string;
  durationSeconds: number;
  config: KeyframeVideoConfig;
  signal?: AbortSignal;
}

interface CommandResult {
  code: number | null;
  stderr: string;
}

const MAX_COMMAND_OUTPUT_CHARS = 12_000;

export async function composeKeyframeVideo(input: ComposeKeyframeVideoInput): Promise<void> {
  if (input.frames.length < 2) {
    throw new KeyframeVideoError("unsupported_provider_behavior", "At least two keyframes are required to compose video.", 502);
  }

  await assertFfmpegAvailable(input.config.ffmpegPath, input.signal);
  await mkdir(input.workDir, { recursive: true });

  const concatPath = join(input.workDir, "frames.ffconcat");
  await writeFile(concatPath, concatFile(input.frames, input.durationSeconds), "utf8");

  if (input.config.interpolation === "ffmpeg") {
    const interpolated = await runFfmpeg(composeArgs(input, concatPath, "ffmpeg"), input.config.ffmpegPath, input.signal);
    if (interpolated.code === 0) {
      await assertOutputVideo(input.outputPath);
      return;
    }
  }

  const fallback = await runFfmpeg(composeArgs(input, concatPath, "fps"), input.config.ffmpegPath, input.signal);
  if (fallback.code !== 0) {
    throw new KeyframeVideoError("upstream_failure", ffmpegFailureMessage(fallback.stderr), 502);
  }

  await assertOutputVideo(input.outputPath);
}

async function assertFfmpegAvailable(ffmpegPath: string, signal: AbortSignal | undefined): Promise<void> {
  const result = await runFfmpeg(["-version"], ffmpegPath, signal);
  if (result.code !== 0) {
    throw new KeyframeVideoError(
      "video_provider_not_configured",
      "FFmpeg is required for keyframe video generation. Install FFmpeg or set FFMPEG_PATH.",
      503
    );
  }
}

function composeArgs(
  input: ComposeKeyframeVideoInput,
  concatPath: string,
  interpolation: KeyframeVideoConfig["interpolation"]
): string[] {
  return [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-safe",
    "0",
    "-f",
    "concat",
    "-i",
    concatPath,
    "-vf",
    videoFilter(input.config, interpolation),
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-movflags",
    "+faststart",
    "-pix_fmt",
    "yuv420p",
    input.outputPath
  ];
}

function videoFilter(config: KeyframeVideoConfig, interpolation: KeyframeVideoConfig["interpolation"]): string {
  const normalize = `scale=${config.width}:${config.height}:force_original_aspect_ratio=increase,crop=${config.width}:${config.height}`;
  const motion = interpolation === "ffmpeg"
    ? `minterpolate=fps=${config.fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`
    : `fps=${config.fps}`;
  return `${normalize},${motion},format=yuv420p`;
}

function concatFile(frames: GeneratedKeyframeImage[], durationSeconds: number): string {
  const frameDuration = Math.max(0.1, durationSeconds / frames.length);
  const lines = ["ffconcat version 1.0"];
  for (const frame of frames) {
    lines.push(`file '${escapeConcatPath(frame.filePath)}'`);
    lines.push(`duration ${frameDuration.toFixed(4)}`);
  }
  lines.push(`file '${escapeConcatPath(frames[frames.length - 1].filePath)}'`);
  return `${lines.join("\n")}\n`;
}

function escapeConcatPath(filePath: string): string {
  return filePath.replace(/\\/gu, "/").replace(/'/gu, "'\\''");
}

async function assertOutputVideo(outputPath: string): Promise<void> {
  const stats = await stat(outputPath).catch(() => undefined);
  if (!stats || stats.size <= 0) {
    throw new KeyframeVideoError("unsupported_provider_behavior", "FFmpeg did not create a playable video file.", 502);
  }
}

function runFfmpeg(args: string[], ffmpegPath: string, signal: AbortSignal | undefined): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";

    const abort = (): void => {
      child.kill("SIGTERM");
    };

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-MAX_COMMAND_OUTPUT_CHARS);
    });
    child.on("error", (error) => {
      resolve({
        code: 1,
        stderr: error.message
      });
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      resolve({
        code,
        stderr
      });
    });

    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function ffmpegFailureMessage(stderr: string): string {
  const detail = sanitizeKeyframeVideoErrorMessage(stderr).trim();
  if (!detail) {
    return "FFmpeg failed while composing the keyframe video.";
  }

  return `FFmpeg failed while composing the keyframe video: ${detail}`;
}
