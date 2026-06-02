import { randomUUID } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import type {
  GenerateVideoRequest,
  VideoBatchDeleteResponse,
  VideoAspectRatio,
  VideoAsset,
  VideoGenerationJob,
  VideoGenerationJobResponse,
  VideoGenerationOutput,
  VideoGenerationProgressStage,
  VideoGenerationStatus,
  VideoLibraryResponse,
  VideoProviderKind,
  VideoProviderStatusResponse
} from "../contracts.js";
import { db } from "../../infrastructure/database.js";
import { runtimePaths } from "../../infrastructure/runtime.js";
import { assets, generationOutputs, videoGenerationOutputs, videoGenerationRecords } from "../../infrastructure/schema.js";
import { LocalAssetStorageAdapter } from "../../infrastructure/storage/asset-storage.js";
import {
  getVideoProviderStatus,
  sanitizeVideoErrorMessage,
  type VideoProvider,
  type VideoProviderProgress,
  type VideoProviderReferenceAsset
} from "../../infrastructure/providers/video-provider.js";
import { readStoredAsset } from "../generation/image-generation.js";

const localAssetStorage = new LocalAssetStorageAdapter();
const PROTECTED_DELETE_STATUSES = new Set<VideoGenerationStatus>(["queued", "running"]);
const STALE_IN_PROGRESS_DELETE_AFTER_MS = 60 * 60 * 1000;

export function getVideoProviderStatusResponse(options: { providerKind?: VideoProviderKind } = {}): VideoProviderStatusResponse {
  return {
    provider: getVideoProviderStatus({
      providerKind: options.providerKind
    })
  };
}

export async function runVideoGeneration(
  input: GenerateVideoRequest,
  provider: VideoProvider
): Promise<VideoGenerationJobResponse> {
  const createdAt = new Date().toISOString();
  const generationId = randomUUID();
  const outputId = randomUUID();
  const size = sizeForAspectRatio(input.aspectRatio);

  db.insert(videoGenerationRecords)
    .values({
      id: generationId,
      mode: input.mode,
      prompt: input.prompt,
      effectivePrompt: input.prompt,
      durationSeconds: input.durationSeconds,
      aspectRatio: input.aspectRatio,
      width: size.width,
      height: size.height,
      provider: provider.id,
      status: "queued",
      error: null,
      referenceAssetId: input.referenceAssetId ?? null,
      progressPercent: 0,
      progressStage: "queued",
      progressMessage: "Queued for video generation.",
      createdAt,
      updatedAt: createdAt
    })
    .run();

  db.insert(videoGenerationOutputs)
    .values({
      id: outputId,
      generationId,
      status: "queued",
      assetId: null,
      providerJobId: null,
      error: null,
      createdAt
    })
    .run();

  queueVideoGeneration({
    createdAt,
    generationId,
    input,
    outputId,
    provider,
    size
  });

  return getVideoJob(generationId) ?? {
    job: {
      id: generationId,
      mode: input.mode,
      prompt: input.prompt,
      effectivePrompt: input.prompt,
      durationSeconds: input.durationSeconds,
      aspectRatio: input.aspectRatio,
      size,
      provider: provider.id,
      status: "queued",
      progressPercent: 0,
      progressStage: "queued",
      progressMessage: "Queued for video generation.",
      referenceAssetId: input.referenceAssetId,
      createdAt,
      updatedAt: createdAt,
      outputs: [{
        id: outputId,
        status: "queued",
        createdAt
      }]
    }
  };
}

function queueVideoGeneration(input: {
  createdAt: string;
  generationId: string;
  input: GenerateVideoRequest;
  outputId: string;
  provider: VideoProvider;
  size: {
    width: number;
    height: number;
  };
}): void {
  void processVideoGeneration(input).catch(() => {
    // processVideoGeneration persists its own failure state.
  });
}

async function processVideoGeneration({
  createdAt,
  generationId,
  input,
  outputId,
  provider,
  size
}: {
  createdAt: string;
  generationId: string;
  input: GenerateVideoRequest;
  outputId: string;
  provider: VideoProvider;
  size: {
    width: number;
    height: number;
  };
}): Promise<void> {
  const startedAt = new Date().toISOString();
  db.update(videoGenerationRecords)
    .set({
      status: "running",
      progressPercent: 10,
      progressStage: "running",
      progressMessage: "Generating video.",
      updatedAt: startedAt
    })
    .where(eq(videoGenerationRecords.id, generationId))
    .run();
  updateVideoOutput(outputId, {
    status: "running",
    error: null
  });

  try {
    const referenceAsset = input.referenceAssetId ? await readReferenceAsset(input.referenceAssetId) : undefined;
    const providerOutput = await provider.generate(
      {
        ...input,
        size,
        referenceAsset,
        onProgress: (progress) => {
          updateVideoProgress(generationId, providerProgressToRecordProgress(progress), outputId);
          rememberProviderJobId(outputId, progress.providerJobId);
        }
      }
    );
    rememberProviderJobId(outputId, providerOutput.providerJobId);
    if (!canUpdateVideoGeneration(generationId, outputId)) {
      return;
    }
    updateVideoProgress(generationId, {
      status: "running",
      progressPercent: 95,
      progressStage: "saving",
      progressMessage: "Saving generated video."
    }, outputId);
    const savedAsset = await saveProviderVideoAsset({
      bytes: providerOutput.bytes,
      mimeType: providerOutput.mimeType,
      fileName: providerOutput.fileName,
      durationSeconds: input.durationSeconds,
      size: providerOutput.size ?? size,
      createdAt
    });
    if (!canUpdateVideoGeneration(generationId, outputId)) {
      await deleteSavedVideoAsset(savedAsset.id);
      return;
    }
    const completedAt = new Date().toISOString();

    db.update(videoGenerationRecords)
      .set({
        status: "succeeded",
        width: providerOutput.size?.width ?? size.width,
        height: providerOutput.size?.height ?? size.height,
        progressPercent: 100,
        progressStage: "succeeded",
        progressMessage: "Video is ready.",
        updatedAt: completedAt
      })
      .where(eq(videoGenerationRecords.id, generationId))
      .run();

    updateVideoOutput(outputId, {
      status: "succeeded",
      assetId: savedAsset.id,
      providerJobId: sanitizedProviderJobId(providerOutput.providerJobId),
      error: null
    });
    if (!isVideoOutputLinkedToAsset(outputId, savedAsset.id)) {
      await deleteSavedVideoAsset(savedAsset.id);
    }
  } catch (error) {
    if (!canUpdateVideoGeneration(generationId, outputId)) {
      return;
    }
    const failedAt = new Date().toISOString();
    const current = db
      .select({
        progressPercent: videoGenerationRecords.progressPercent,
        progressStage: videoGenerationRecords.progressStage,
        progressMessage: videoGenerationRecords.progressMessage
      })
      .from(videoGenerationRecords)
      .where(eq(videoGenerationRecords.id, generationId))
      .get();
    const message = videoGenerationFailureMessage(error, outputId, current?.progressStage);

    db.update(videoGenerationRecords)
      .set({
        status: "failed",
        error: message,
        progressPercent: current?.progressPercent ?? 10,
        progressStage: "failed",
        progressMessage: message,
        updatedAt: failedAt
      })
      .where(eq(videoGenerationRecords.id, generationId))
      .run();

    updateVideoOutput(outputId, {
      status: "failed",
      assetId: null,
      error: message
    });
  }
}

export function getVideoJob(jobId: string): VideoGenerationJobResponse | undefined {
  const record = db.select().from(videoGenerationRecords).where(eq(videoGenerationRecords.id, jobId)).get();
  if (!record) {
    return undefined;
  }

  const outputs = db
    .select({
      output: videoGenerationOutputs,
      asset: assets
    })
    .from(videoGenerationOutputs)
    .leftJoin(assets, eq(videoGenerationOutputs.assetId, assets.id))
    .where(eq(videoGenerationOutputs.generationId, record.id))
    .orderBy(videoGenerationOutputs.createdAt)
    .all();

  return {
    job: toVideoGenerationJob(
      record,
      outputs.map(({ output, asset }) => ({
        id: output.id,
        status: output.status as VideoGenerationStatus,
        asset: asset ? toVideoAsset(asset, record.durationSeconds) : undefined,
        providerJobId: output.providerJobId ?? undefined,
        error: output.error ? sanitizeVideoErrorMessage(output.error) : undefined,
        createdAt: output.createdAt
      }))
    )
  };
}

export function getVideoLibrary(): VideoLibraryResponse {
  const rows = db
    .select({
      output: videoGenerationOutputs,
      generation: videoGenerationRecords,
      asset: assets
    })
    .from(videoGenerationOutputs)
    .innerJoin(videoGenerationRecords, eq(videoGenerationOutputs.generationId, videoGenerationRecords.id))
    .leftJoin(assets, eq(videoGenerationOutputs.assetId, assets.id))
    .orderBy(desc(videoGenerationOutputs.createdAt))
    .all();

  return {
    items: rows.map(({ output, generation, asset }) => ({
      outputId: output.id,
      generationId: generation.id,
      mode: generation.mode as VideoGenerationJob["mode"],
      prompt: generation.prompt,
      effectivePrompt: generation.effectivePrompt,
      durationSeconds: generation.durationSeconds,
      aspectRatio: generation.aspectRatio as VideoAspectRatio,
      size: {
        width: generation.width,
        height: generation.height
      },
      provider: generation.provider,
      status: output.status as VideoGenerationStatus,
      progressPercent: generation.progressPercent,
      progressStage: generation.progressStage,
      progressMessage: generation.progressMessage ?? undefined,
      error: output.error ? sanitizeVideoErrorMessage(output.error) : generation.error ? sanitizeVideoErrorMessage(generation.error) : undefined,
      referenceAssetId: generation.referenceAssetId ?? undefined,
      providerJobId: output.providerJobId ?? undefined,
      createdAt: output.createdAt,
      asset: asset ? toVideoAsset(asset, generation.durationSeconds) : undefined
    }))
  };
}

export async function deleteVideoOutput(outputId: string): Promise<"deleted" | "not_found" | "skipped" | "failed"> {
  try {
    return await deleteVideoOutputById(outputId);
  } catch {
    return "failed";
  }
}

export async function batchDeleteVideoOutputs(outputIds: string[]): Promise<VideoBatchDeleteResponse> {
  const result: VideoBatchDeleteResponse = {
    deletedIds: [],
    notFoundIds: [],
    skippedIds: [],
    failedIds: []
  };

  for (const outputId of outputIds) {
    const status = await deleteVideoOutput(outputId);
    if (status === "deleted") {
      result.deletedIds.push(outputId);
    } else if (status === "not_found") {
      result.notFoundIds.push(outputId);
    } else if (status === "skipped") {
      result.skippedIds.push(outputId);
    } else {
      result.failedIds.push(outputId);
    }
  }

  return result;
}

async function deleteVideoOutputById(outputId: string): Promise<"deleted" | "not_found" | "skipped"> {
  const existing = db
    .select({
      output: videoGenerationOutputs,
      generation: videoGenerationRecords,
      asset: assets
    })
    .from(videoGenerationOutputs)
    .innerJoin(videoGenerationRecords, eq(videoGenerationOutputs.generationId, videoGenerationRecords.id))
    .leftJoin(assets, eq(videoGenerationOutputs.assetId, assets.id))
    .where(eq(videoGenerationOutputs.id, outputId))
    .get();

  if (!existing) {
    return "not_found";
  }

  const outputStatus = existing.output.status as VideoGenerationStatus;
  const generationStatus = existing.generation.status as VideoGenerationStatus;
  const isProtectedInProgress = PROTECTED_DELETE_STATUSES.has(outputStatus) || PROTECTED_DELETE_STATUSES.has(generationStatus);
  if (isProtectedInProgress && !isStaleInProgressVideoItem(existing.output.createdAt)) {
    return "skipped";
  }

  db.delete(videoGenerationOutputs).where(eq(videoGenerationOutputs.id, outputId)).run();

  if (existing.asset?.id && isAssetOrphaned(existing.asset.id)) {
    await deleteLocalAsset(existing.asset);
    db.delete(assets).where(eq(assets.id, existing.asset.id)).run();
  }

  return "deleted";
}

export function isGeneratedImageAsset(assetId: string): boolean {
  const row = db
    .select({ id: generationOutputs.id })
    .from(generationOutputs)
    .where(and(eq(generationOutputs.assetId, assetId), eq(generationOutputs.status, "succeeded")))
    .limit(1)
    .get();

  return Boolean(row);
}

function toVideoGenerationJob(
  record: typeof videoGenerationRecords.$inferSelect,
  outputs: VideoGenerationOutput[]
): VideoGenerationJob {
  return {
    id: record.id,
    mode: record.mode as VideoGenerationJob["mode"],
    prompt: record.prompt,
    effectivePrompt: record.effectivePrompt,
    durationSeconds: record.durationSeconds,
    aspectRatio: record.aspectRatio as VideoAspectRatio,
    size: {
      width: record.width,
      height: record.height
    },
    provider: record.provider,
    status: record.status as VideoGenerationStatus,
    progressPercent: record.progressPercent,
    progressStage: record.progressStage,
    progressMessage: record.progressMessage ?? undefined,
    error: record.error ? sanitizeVideoErrorMessage(record.error) : undefined,
    referenceAssetId: record.referenceAssetId ?? undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    outputs
  };
}

function toVideoAsset(asset: typeof assets.$inferSelect, durationSeconds: number): VideoAsset {
  return {
    id: asset.id,
    url: `/api/assets/${asset.id}`,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    durationSeconds
  };
}

function updateVideoProgress(
  generationId: string,
  progress: {
    status?: VideoGenerationStatus;
    progressPercent: number;
    progressStage: VideoGenerationProgressStage | string;
    progressMessage: string;
  },
  outputId?: string
): void {
  if (outputId && !canUpdateVideoGeneration(generationId, outputId)) {
    return;
  }

  db.update(videoGenerationRecords)
    .set({
      status: progress.status,
      progressPercent: progress.progressPercent,
      progressStage: progress.progressStage,
      progressMessage: progress.progressMessage,
      updatedAt: new Date().toISOString()
    })
    .where(eq(videoGenerationRecords.id, generationId))
    .run();
}

function canUpdateVideoGeneration(generationId: string, outputId: string): boolean {
  const row = db
    .select({
      outputStatus: videoGenerationOutputs.status,
      generationStatus: videoGenerationRecords.status
    })
    .from(videoGenerationOutputs)
    .innerJoin(videoGenerationRecords, eq(videoGenerationOutputs.generationId, videoGenerationRecords.id))
    .where(and(eq(videoGenerationOutputs.id, outputId), eq(videoGenerationRecords.id, generationId)))
    .get();

  if (!row) {
    return false;
  }

  const outputStatus = row.outputStatus as VideoGenerationStatus;
  const generationStatus = row.generationStatus as VideoGenerationStatus;
  return PROTECTED_DELETE_STATUSES.has(outputStatus) && PROTECTED_DELETE_STATUSES.has(generationStatus);
}

function isVideoOutputLinkedToAsset(outputId: string, assetId: string): boolean {
  const row = db
    .select({ id: videoGenerationOutputs.id })
    .from(videoGenerationOutputs)
    .where(and(eq(videoGenerationOutputs.id, outputId), eq(videoGenerationOutputs.assetId, assetId)))
    .get();

  return Boolean(row);
}

function providerProgressToRecordProgress(progress: VideoProviderProgress): {
  status: VideoGenerationStatus;
  progressPercent: number;
  progressStage: VideoGenerationProgressStage | string;
  progressMessage: string;
} {
  return {
    status: "running",
    progressPercent: clampProgressPercent(progress.progressPercent, 0, 94),
    progressStage: progress.progressStage,
    progressMessage: sanitizeVideoErrorMessage(progress.progressMessage)
  };
}

function clampProgressPercent(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.round(value)));
}

function updateVideoOutput(
  outputId: string,
  values: {
    status: VideoGenerationStatus;
    assetId?: string | null;
    providerJobId?: string | null;
    error?: string | null;
  }
): void {
  const nextValues = {
    ...values
  };
  if (values.providerJobId !== undefined) {
    nextValues.providerJobId = sanitizedProviderJobId(values.providerJobId);
  }

  db.update(videoGenerationOutputs)
    .set(nextValues)
    .where(eq(videoGenerationOutputs.id, outputId))
    .run();
}

function rememberProviderJobId(outputId: string, providerJobId: string | undefined): void {
  const sanitized = sanitizedProviderJobId(providerJobId);
  if (!sanitized) {
    return;
  }

  db.update(videoGenerationOutputs)
    .set({
      providerJobId: sanitized
    })
    .where(eq(videoGenerationOutputs.id, outputId))
    .run();
}

async function saveProviderVideoAsset(input: {
  bytes: Buffer;
  mimeType: string;
  fileName: string | undefined;
  durationSeconds: number;
  size: {
    width: number;
    height: number;
  };
  createdAt: string;
}): Promise<VideoAsset> {
  if (!input.mimeType.startsWith("video/")) {
    throw new Error("Video provider returned a non-video asset.");
  }

  const assetId = randomUUID();
  const extension = extensionForVideoMimeType(input.mimeType, input.fileName);
  const fileName = `${assetId}.${extension}`;
  const relativePath = `assets/${fileName}`;
  const filePath = resolve(runtimePaths.dataDir, relativePath);

  if (!isInsideDirectory(filePath, runtimePaths.assetsDir)) {
    throw new Error("Generated video asset path is invalid.");
  }

  await localAssetStorage.putObject({ filePath, bytes: input.bytes });

  db.insert(assets)
    .values({
      id: assetId,
      fileName,
      relativePath,
      mimeType: input.mimeType,
      width: input.size.width,
      height: input.size.height,
      createdAt: input.createdAt
    })
    .run();

  return {
    id: assetId,
    url: `/api/assets/${assetId}`,
    fileName,
    mimeType: input.mimeType,
    width: input.size.width,
    height: input.size.height,
    durationSeconds: input.durationSeconds
  };
}

async function readReferenceAsset(assetId: string): Promise<VideoProviderReferenceAsset> {
  const asset = await readStoredAsset(assetId);
  if (!asset || !asset.file.mimeType.startsWith("image/")) {
    throw new Error("Image-to-video reference asset was not found.");
  }

  return {
    id: asset.file.id,
    fileName: asset.file.fileName,
    mimeType: asset.file.mimeType,
    dataUrl: `data:${asset.file.mimeType};base64,${asset.bytes.toString("base64")}`
  };
}

function sizeForAspectRatio(aspectRatio: VideoAspectRatio): { width: number; height: number } {
  switch (aspectRatio) {
    case "9:16":
      return { width: 720, height: 1280 };
    case "1:1":
      return { width: 1024, height: 1024 };
    case "16:9":
    default:
      return { width: 1280, height: 720 };
  }
}

function extensionForVideoMimeType(mimeType: string, fileName: string | undefined): string {
  const normalizedFileName = fileName?.toLowerCase() ?? "";
  if (normalizedFileName.endsWith(".mp4") || mimeType === "video/mp4") {
    return "mp4";
  }
  if (normalizedFileName.endsWith(".webm") || mimeType === "video/webm") {
    return "webm";
  }
  if (normalizedFileName.endsWith(".mov") || mimeType === "video/quicktime") {
    return "mov";
  }
  return "mp4";
}

function isAssetOrphaned(assetId: string): boolean {
  const referencedByImageOutput = db
    .select({ id: generationOutputs.id })
    .from(generationOutputs)
    .where(eq(generationOutputs.assetId, assetId))
    .limit(1)
    .get();

  if (referencedByImageOutput) {
    return false;
  }

  const referencedByVideoOutput = db
    .select({ id: videoGenerationOutputs.id })
    .from(videoGenerationOutputs)
    .where(eq(videoGenerationOutputs.assetId, assetId))
    .limit(1)
    .get();

  return !referencedByVideoOutput;
}

async function deleteLocalAsset(asset: typeof assets.$inferSelect): Promise<void> {
  const filePath = resolve(runtimePaths.dataDir, asset.relativePath);
  if (!isInsideDirectory(filePath, runtimePaths.assetsDir)) {
    return;
  }

  await localAssetStorage.deleteObject({ filePath });
}

async function deleteSavedVideoAsset(assetId: string): Promise<void> {
  const asset = db.select().from(assets).where(eq(assets.id, assetId)).get();
  if (!asset) {
    return;
  }

  await deleteLocalAsset(asset);
  db.delete(assets).where(eq(assets.id, assetId)).run();
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Video generation failed.";
}

function videoGenerationFailureMessage(error: unknown, outputId: string, progressStage: string | undefined): string {
  const baseMessage = sanitizeVideoErrorMessage(errorToMessage(error));
  const providerJobId = db
    .select({
      providerJobId: videoGenerationOutputs.providerJobId
    })
    .from(videoGenerationOutputs)
    .where(eq(videoGenerationOutputs.id, outputId))
    .get()?.providerJobId ?? undefined;
  const safeProviderJobId = sanitizedProviderJobIdValue(providerJobId);

  if (isLikelyVideoDownloadFailure(baseMessage, progressStage)) {
    const taskContext = safeProviderJobId ? ` Remote provider task id: ${safeProviderJobId}.` : "";
    return sanitizeVideoErrorMessage(
      `The provider reported a completed video, but this server could not download the video file.${taskContext} ${baseMessage} Configure VIDEO_PROVIDER_DOWNLOAD_PROXY_URL if the provider CDN is unreachable from this machine.`
    );
  }

  if (safeProviderJobId && !baseMessage.includes(safeProviderJobId)) {
    return sanitizeVideoErrorMessage(`${baseMessage} Remote provider task id: ${safeProviderJobId}.`);
  }

  return baseMessage;
}

function isLikelyVideoDownloadFailure(message: string, progressStage: string | undefined): boolean {
  const normalized = message.toLowerCase();
  return (
    progressStage === "saving" ||
    normalized.includes("download") ||
    normalized.includes("fetch failed") ||
    normalized.includes("provider cdn") ||
    normalized.includes("video url")
  );
}

function sanitizedProviderJobId(value: string | null | undefined): string | null {
  return sanitizedProviderJobIdValue(value) ?? null;
}

function sanitizedProviderJobIdValue(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.replace(/[\r\n\t]/gu, " ").slice(0, 256);
}

function isInsideDirectory(filePath: string, directory: string): boolean {
  const localPath = relative(directory, filePath);
  return Boolean(localPath) && !localPath.startsWith("..") && !isAbsolute(localPath);
}

function isStaleInProgressVideoItem(createdAt: string, nowMs = Date.now()): boolean {
  const createdMs = Date.parse(createdAt);
  return Number.isFinite(createdMs) && nowMs - createdMs >= STALE_IN_PROGRESS_DELETE_AFTER_MS;
}
