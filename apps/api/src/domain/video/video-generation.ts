import { randomUUID } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import type {
  GenerateVideoRequest,
  VideoAspectRatio,
  VideoAsset,
  VideoGenerationJob,
  VideoGenerationJobResponse,
  VideoGenerationOutput,
  VideoGenerationStatus,
  VideoLibraryResponse,
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
  type VideoProviderReferenceAsset
} from "../../infrastructure/providers/video-provider.js";
import { readStoredAsset } from "../generation/image-generation.js";

const localAssetStorage = new LocalAssetStorageAdapter();

export function getVideoProviderStatusResponse(): VideoProviderStatusResponse {
  return {
    provider: getVideoProviderStatus()
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
      createdAt,
      updatedAt: createdAt
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
      referenceAssetId: input.referenceAssetId,
      createdAt,
      updatedAt: createdAt,
      outputs: []
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
      updatedAt: startedAt
    })
    .where(eq(videoGenerationRecords.id, generationId))
    .run();

  try {
    const referenceAsset = input.referenceAssetId ? await readReferenceAsset(input.referenceAssetId) : undefined;
    const providerOutput = await provider.generate(
      {
        ...input,
        size,
        referenceAsset
      }
    );
    const savedAsset = await saveProviderVideoAsset({
      bytes: providerOutput.bytes,
      mimeType: providerOutput.mimeType,
      fileName: providerOutput.fileName,
      durationSeconds: input.durationSeconds,
      size,
      createdAt
    });
    const completedAt = new Date().toISOString();

    db.update(videoGenerationRecords)
      .set({
        status: "succeeded",
        updatedAt: completedAt
      })
      .where(eq(videoGenerationRecords.id, generationId))
      .run();

    db.insert(videoGenerationOutputs)
      .values({
        id: outputId,
        generationId,
        status: "succeeded",
        assetId: savedAsset.id,
        error: null,
        createdAt: completedAt
      })
      .run();
  } catch (error) {
    const failedAt = new Date().toISOString();
    const message = sanitizeVideoErrorMessage(errorToMessage(error));

    db.update(videoGenerationRecords)
      .set({
        status: "failed",
        error: message,
        updatedAt: failedAt
      })
      .where(eq(videoGenerationRecords.id, generationId))
      .run();

    db.insert(videoGenerationOutputs)
      .values({
        id: outputId,
        generationId,
        status: "failed",
        assetId: null,
        error: message,
        createdAt: failedAt
      })
      .run();
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
      error: output.error ? sanitizeVideoErrorMessage(output.error) : generation.error ? sanitizeVideoErrorMessage(generation.error) : undefined,
      referenceAssetId: generation.referenceAssetId ?? undefined,
      createdAt: output.createdAt,
      asset: asset ? toVideoAsset(asset, generation.durationSeconds) : undefined
    }))
  };
}

export async function deleteVideoOutput(outputId: string): Promise<boolean> {
  const existing = db
    .select({
      output: videoGenerationOutputs,
      asset: assets
    })
    .from(videoGenerationOutputs)
    .leftJoin(assets, eq(videoGenerationOutputs.assetId, assets.id))
    .where(eq(videoGenerationOutputs.id, outputId))
    .get();

  if (!existing) {
    return false;
  }

  db.delete(videoGenerationOutputs).where(eq(videoGenerationOutputs.id, outputId)).run();

  if (existing.asset?.id && isAssetOrphaned(existing.asset.id)) {
    await deleteLocalAsset(existing.asset);
    db.delete(assets).where(eq(assets.id, existing.asset.id)).run();
  }

  return true;
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

function errorToMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Video generation failed.";
}

function isInsideDirectory(filePath: string, directory: string): boolean {
  const localPath = relative(directory, filePath);
  return Boolean(localPath) && !localPath.startsWith("..") && !isAbsolute(localPath);
}
