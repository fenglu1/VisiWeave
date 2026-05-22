import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const dataDir = resolve(process.cwd(), ".codex-temp", `video-batch-delete-smoke-${randomUUID()}`);
process.env.DATA_DIR = dataDir;
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";

async function main(): Promise<void> {
  const { eq } = await import("drizzle-orm");
  const { db, closeDatabase } = await import("../infrastructure/database.js");
  const { runtimePaths } = await import("../infrastructure/runtime.js");
  const { assets, videoGenerationOutputs, videoGenerationRecords } = await import("../infrastructure/schema.js");
  const { app } = await import("../server/app.js");

  try {
    const now = new Date().toISOString();
    const succeeded = await seedVideoOutput({
      now,
      status: "succeeded",
      withAsset: true
    });
    const failed = await seedVideoOutput({
      now,
      status: "failed",
      withAsset: false
    });
    const running = await seedVideoOutput({
      now,
      status: "running",
      withAsset: false
    });
    const missingId = randomUUID();

    const response = await app.fetch(
      new Request("http://localhost/api/videos/batch-delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          outputIds: [succeeded.outputId, failed.outputId, running.outputId, missingId]
        })
      })
    );

    expect(response.status === 200, `batch delete returns 200, received ${response.status}`);
    const body = (await response.json()) as {
      deletedIds?: string[];
      notFoundIds?: string[];
      skippedIds?: string[];
      failedIds?: string[];
    };

    expect(matchesSet(body.deletedIds, [succeeded.outputId, failed.outputId]), "completed and failed outputs are deleted");
    expect(matchesSet(body.notFoundIds, [missingId]), "missing outputs are reported as not found");
    expect(matchesSet(body.skippedIds, [running.outputId]), "running outputs are skipped");
    expect(matchesSet(body.failedIds, []), "no output deletions fail");

    expect(!db.select().from(videoGenerationOutputs).where(eq(videoGenerationOutputs.id, succeeded.outputId)).get(), "succeeded output row is removed");
    expect(!db.select().from(videoGenerationOutputs).where(eq(videoGenerationOutputs.id, failed.outputId)).get(), "failed output row is removed");
    expect(db.select().from(videoGenerationOutputs).where(eq(videoGenerationOutputs.id, running.outputId)).get(), "running output row is retained");
    expect(succeeded.assetId, "succeeded seed has an asset id");
    expect(!db.select().from(assets).where(eq(assets.id, succeeded.assetId)).get(), "orphaned succeeded video asset row is removed");

    console.log("video batch delete smoke checks passed");
  } finally {
    closeDatabase();
    await rm(dataDir, { recursive: true, force: true });
  }
}

async function seedVideoOutput(input: {
  now: string;
  status: "succeeded" | "failed" | "running";
  withAsset: boolean;
}): Promise<{ generationId: string; outputId: string; assetId: string | null }> {
  const { db } = await import("../infrastructure/database.js");
  const { runtimePaths } = await import("../infrastructure/runtime.js");
  const { assets, videoGenerationOutputs, videoGenerationRecords } = await import("../infrastructure/schema.js");
  const generationId = randomUUID();
  const outputId = randomUUID();
  const assetId = input.withAsset ? randomUUID() : null;

  if (assetId) {
    const fileName = `${assetId}.mp4`;
    await writeFile(resolve(runtimePaths.assetsDir, fileName), Buffer.from("fake mp4 bytes", "utf8"));
    db
      .insert(assets)
      .values({
        id: assetId,
        fileName,
        relativePath: `assets/${fileName}`,
        mimeType: "video/mp4",
        width: 1280,
        height: 720,
        createdAt: input.now
      })
      .run();
  }

  db
    .insert(videoGenerationRecords)
    .values({
      id: generationId,
      mode: "text_to_video",
      prompt: `Smoke ${input.status}`,
      effectivePrompt: `Smoke ${input.status}`,
      durationSeconds: 5,
      aspectRatio: "16:9",
      width: 1280,
      height: 720,
      provider: "smoke-video-provider",
      status: input.status,
      error: input.status === "failed" ? "Provider failed." : null,
      referenceAssetId: null,
      progressPercent: input.status === "succeeded" ? 100 : input.status === "failed" ? 10 : 10,
      progressStage: input.status,
      progressMessage: input.status === "succeeded" ? "Video is ready." : input.status === "failed" ? "Provider failed." : "Generating video.",
      createdAt: input.now,
      updatedAt: input.now
    })
    .run();

  db
    .insert(videoGenerationOutputs)
    .values({
      id: outputId,
      generationId,
      status: input.status,
      assetId,
      error: input.status === "failed" ? "Provider failed." : null,
      createdAt: input.now
    })
    .run();

  return {
    generationId,
    outputId,
    assetId
  };
}

function matchesSet(actual: string[] | undefined, expected: string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length && expected.every((id) => actual.includes(id));
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
