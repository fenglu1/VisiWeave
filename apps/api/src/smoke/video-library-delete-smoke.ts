import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const dataDir = resolve(process.cwd(), ".codex-temp", `video-library-delete-smoke-${randomUUID()}`);
process.env.DATA_DIR = dataDir;
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";

async function main(): Promise<void> {
  const { eq } = await import("drizzle-orm");
  const { closeDatabase, db } = await import("../infrastructure/database.js");
  const { videoGenerationOutputs, videoGenerationRecords } = await import("../infrastructure/schema.js");
  const { app } = await import("../server/app.js");

  try {
    const nowMs = Date.now();
    const freshRunning = seedVideoOutput(db, { videoGenerationOutputs, videoGenerationRecords }, {
      createdAt: new Date(nowMs - 30 * 60 * 1000).toISOString(),
      status: "running"
    });
    const staleRunning = seedVideoOutput(db, { videoGenerationOutputs, videoGenerationRecords }, {
      createdAt: new Date(nowMs - 61 * 60 * 1000).toISOString(),
      status: "running"
    });
    const staleQueued = seedVideoOutput(db, { videoGenerationOutputs, videoGenerationRecords }, {
      createdAt: new Date(nowMs - 2 * 60 * 60 * 1000).toISOString(),
      status: "queued"
    });
    const freshQueued = seedVideoOutput(db, { videoGenerationOutputs, videoGenerationRecords }, {
      createdAt: new Date(nowMs - 10 * 60 * 1000).toISOString(),
      status: "queued"
    });

    const freshDelete = await app.fetch(
      new Request(`http://localhost/api/videos/${freshRunning.outputId}`, {
        method: "DELETE"
      })
    );
    expect(freshDelete.status === 409, `fresh running delete is protected, received ${freshDelete.status}`);
    expect(
      db.select().from(videoGenerationOutputs).where(eq(videoGenerationOutputs.id, freshRunning.outputId)).get(),
      "fresh running output row is retained"
    );

    const staleDelete = await app.fetch(
      new Request(`http://localhost/api/videos/${staleRunning.outputId}`, {
        method: "DELETE"
      })
    );
    expect(staleDelete.status === 200, `stale running delete succeeds, received ${staleDelete.status}`);
    expect(
      !db.select().from(videoGenerationOutputs).where(eq(videoGenerationOutputs.id, staleRunning.outputId)).get(),
      "stale running output row is removed"
    );

    const batchResponse = await app.fetch(
      new Request("http://localhost/api/videos/batch-delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          outputIds: [staleQueued.outputId, freshQueued.outputId]
        })
      })
    );

    expect(batchResponse.status === 200, `batch delete returns 200, received ${batchResponse.status}`);
    const body = (await batchResponse.json()) as {
      deletedIds?: string[];
      skippedIds?: string[];
      notFoundIds?: string[];
      failedIds?: string[];
    };
    expect(matchesSet(body.deletedIds, [staleQueued.outputId]), "stale queued output appears in deletedIds");
    expect(matchesSet(body.skippedIds, [freshQueued.outputId]), "fresh queued output appears in skippedIds");
    expect(matchesSet(body.notFoundIds, []), "no output is reported as not found");
    expect(matchesSet(body.failedIds, []), "no output deletion fails");

    console.log("video library delete smoke checks passed");
  } finally {
    closeDatabase();
    await rm(dataDir, { recursive: true, force: true });
  }
}

function seedVideoOutput(
  db: typeof import("../infrastructure/database.js").db,
  tables: {
    videoGenerationOutputs: typeof import("../infrastructure/schema.js").videoGenerationOutputs;
    videoGenerationRecords: typeof import("../infrastructure/schema.js").videoGenerationRecords;
  },
  input: {
  createdAt: string;
  status: "queued" | "running";
}): { generationId: string; outputId: string } {
  const generationId = randomUUID();
  const outputId = randomUUID();

  db
    .insert(tables.videoGenerationRecords)
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
      error: null,
      referenceAssetId: null,
      progressPercent: input.status === "queued" ? 0 : 10,
      progressStage: input.status,
      progressMessage: input.status === "queued" ? "Queued for video generation." : "Generating video.",
      createdAt: input.createdAt,
      updatedAt: input.createdAt
    })
    .run();

  db
    .insert(tables.videoGenerationOutputs)
    .values({
      id: outputId,
      generationId,
      status: input.status,
      assetId: null,
      error: null,
      createdAt: input.createdAt
    })
    .run();

  return {
    generationId,
    outputId
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
