import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { GenerateVideoRequest, VideoLibraryItem, VideoLibraryResponse } from "../domain/contracts.js";
import type { VideoProvider, VideoProviderInput, VideoProviderOutput } from "../infrastructure/providers/video-provider.js";

const dataDir = resolve(process.cwd(), ".codex-temp", `video-library-progress-smoke-${randomUUID()}`);
process.env.DATA_DIR = dataDir;
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";

async function main(): Promise<void> {
  const { closeDatabase } = await import("../infrastructure/database.js");
  const { getVideoJob, getVideoLibrary, runVideoGeneration } = await import("../domain/video/video-generation.js");

  try {
    let finishProvider: ((output: VideoProviderOutput) => void) | undefined;
    const provider: VideoProvider = {
      id: "smoke-video-provider",
      generate: async (input: VideoProviderInput): Promise<VideoProviderOutput> => {
        input.onProgress?.({
          progressPercent: 42,
          progressStage: "generating_keyframes",
          progressMessage: "Generated 2 of 5 keyframes.",
          providerJobId: "remote-smoke-task"
        });

        return new Promise((resolveProvider) => {
          finishProvider = resolveProvider;
        });
      }
    };

    const request: GenerateVideoRequest = {
      prompt: "A tiny robot waving from a train window",
      mode: "text_to_video",
      durationSeconds: 5,
      aspectRatio: "16:9"
    };

    const created = await runVideoGeneration(request, provider);
    expect(created.job.outputs.length === 1, "created video job immediately exposes one output");
    expect(created.job.outputs[0].status === "queued" || created.job.outputs[0].status === "running", "created output is queued or running");
    expect(hasProgressFields(created.job), "created job exposes progress fields");

    const inFlightItem = await waitForLibraryItem(created.job.id, getVideoLibrary);
    expect(inFlightItem, "video library immediately includes the queued or running output");
    expect(inFlightItem.status === "queued" || inFlightItem.status === "running", "library output remains queued or running while provider is pending");
    expect(hasProgressFields(inFlightItem), "library item exposes progress fields");
    expect(inFlightItem.progressPercent === 42, "library item reflects provider-reported progress while provider is pending");
    expect(inFlightItem.progressStage === "generating_keyframes", "library item reflects provider-reported progress stage");
    expect(inFlightItem.progressMessage === "Generated 2 of 5 keyframes.", "library item reflects provider-reported progress message");
    expect(inFlightItem.providerJobId === "remote-smoke-task", "library item exposes provider-reported remote task id while provider is pending");

    finishProvider?.({
      bytes: Buffer.from("fake mp4 bytes", "utf8"),
      mimeType: "video/mp4",
      fileName: "smoke.mp4",
      providerJobId: "remote-smoke-task",
      size: {
        width: 1280,
        height: 720
      }
    });

    const completed = await waitForJob(created.job.id, getVideoJob);
    expect(completed.status === "succeeded", "video job eventually succeeds");
    expect(completed.progressPercent === 100, "succeeded video job reports 100 percent progress");
    expect(completed.progressStage === "succeeded", "succeeded video job reports succeeded progress stage");
    expect(completed.outputs.length === 1 && completed.outputs[0].status === "succeeded", "existing output row is updated to succeeded");
    expect(completed.outputs[0].providerJobId === "remote-smoke-task", "succeeded output keeps the remote provider task id");

    const failingProvider: VideoProvider = {
      id: "smoke-failing-video-provider",
      generate: async (input: VideoProviderInput): Promise<VideoProviderOutput> => {
        input.onProgress?.({
          progressPercent: 94,
          progressStage: "saving",
          progressMessage: "Remote video is ready; downloading.",
          providerJobId: "remote-failed-task"
        });
        throw new Error("fetch failed");
      }
    };

    const failedCreated = await runVideoGeneration({
      prompt: "A tiny robot waving from a train window",
      mode: "text_to_video",
      durationSeconds: 5,
      aspectRatio: "16:9"
    }, failingProvider);
    const failed = await waitForJob(failedCreated.job.id, getVideoJob);
    expect(failed.status === "failed", "failed provider job eventually fails");
    expect(failed.outputs[0].providerJobId === "remote-failed-task", "failed output keeps the remote provider task id");
    expect((failed.error ?? "").includes("remote-failed-task"), "failed job error includes the remote provider task id");
    expect((failed.error ?? "").toLowerCase().includes("download"), "failed job error explains the provider video download problem");

    console.log("video library progress smoke checks passed");
  } finally {
    closeDatabase();
    await rm(dataDir, { recursive: true, force: true });
  }
}

async function waitForJob(
  jobId: string,
  getVideoJob: (jobId: string) => {
    job: {
      status: string;
      progressPercent: number;
      progressStage: string;
      error?: string;
      outputs: Array<{
        status: string;
        providerJobId?: string;
      }>;
    };
  } | undefined
): Promise<{
  status: string;
  progressPercent: number;
  progressStage: string;
  error?: string;
  outputs: Array<{
    status: string;
    providerJobId?: string;
  }>;
}> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const job = getVideoJob(jobId)?.job;
    if (job?.status === "succeeded" || job?.status === "failed") {
      return job;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }

  throw new Error("Video job did not complete in time.");
}

async function waitForLibraryItem(
  generationId: string,
  getVideoLibrary: () => VideoLibraryResponse
): Promise<VideoLibraryItem> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const item = getVideoLibrary().items.find((candidate) => candidate.generationId === generationId);
    if (item?.progressPercent === 42) {
      return item;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }

  throw new Error("Video library item did not receive provider progress in time.");
}

function hasProgressFields(value: { progressPercent?: unknown; progressStage?: unknown; progressMessage?: unknown }): boolean {
  return typeof value.progressPercent === "number" && typeof value.progressStage === "string" && "progressMessage" in value;
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
