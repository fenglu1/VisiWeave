import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EditImageProviderInput, ImageProvider, ImageProviderInput, ProviderResult } from "../infrastructure/providers/image-provider.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const dataDir = resolve(repoRoot, ".codex-temp", `image-generation-retry-smoke-${process.pid}-${Date.now()}`);
process.env.DATA_DIR = dataDir;
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";

mkdirSync(dataDir, { recursive: true });

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

async function main(): Promise<void> {
  try {
    const [{ runReferenceImageGeneration, runTextToImageGeneration }, { closeDatabase }] = await Promise.all([
      import("../domain/generation/image-generation.js"),
      import("../infrastructure/database.js")
    ]);

    try {
      const flakyTextProvider = new FakeImageProvider({ generateFailuresBeforeSuccess: 2 });
      const textResponse = await runTextToImageGeneration(inputFixture({ count: 4 }), flakyTextProvider);
      expect(textResponse.record.status === "succeeded", "text generation recovers failed outputs after one retry");
      expect(textResponse.record.outputs.filter((output) => output.status === "succeeded").length === 4, "all text outputs succeed after retry");
      expect(flakyTextProvider.generateCalls === 6, "text generation retries only the two failed outputs");

      const flakyEditProvider = new FakeImageProvider({ editFailuresBeforeSuccess: 2 });
      const editResponse = await runReferenceImageGeneration(editInputFixture({ count: 4 }), flakyEditProvider);
      expect(editResponse.record.status === "succeeded", "reference edit generation recovers failed outputs after one retry");
      expect(editResponse.record.outputs.filter((output) => output.status === "succeeded").length === 4, "all edit outputs succeed after retry");
      expect(flakyEditProvider.editCalls === 6, "edit generation retries only the two failed outputs");

      const failingTextProvider = new FakeImageProvider({ alwaysFailGenerate: true });
      const failedTextResponse = await runTextToImageGeneration(inputFixture({ count: 3 }), failingTextProvider);
      expect(failedTextResponse.record.status === "failed", "persistent text failures keep the generation failed");
      expect(failedTextResponse.record.outputs.length === 3, "persistent text failures keep one output record per requested image");
      expect(failedTextResponse.record.outputs.every((output) => output.status === "failed" && output.error), "persistent text failures keep output errors");
      expect(failingTextProvider.generateCalls === 6, "persistent text failures stop after one retry per failed output");
    } finally {
      closeDatabase();
    }

    console.log("image generation retry smoke checks passed");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

class FakeImageProvider implements ImageProvider {
  generateCalls = 0;
  editCalls = 0;

  constructor(
    private readonly options: {
      generateFailuresBeforeSuccess?: number;
      editFailuresBeforeSuccess?: number;
      alwaysFailGenerate?: boolean;
    } = {}
  ) {}

  async generate(input: ImageProviderInput): Promise<ProviderResult> {
    this.generateCalls += 1;
    if (this.options.alwaysFailGenerate || this.generateCalls <= (this.options.generateFailuresBeforeSuccess ?? 0)) {
      throw new Error(`fake text generation failure ${this.generateCalls}`);
    }

    return providerResult(input.sizeApiValue);
  }

  async edit(input: EditImageProviderInput): Promise<ProviderResult> {
    this.editCalls += 1;
    expect(input.referenceImages.length > 0, "edit generation receives references");
    if (this.editCalls <= (this.options.editFailuresBeforeSuccess ?? 0)) {
      throw new Error(`fake edit generation failure ${this.editCalls}`);
    }

    return providerResult(input.sizeApiValue);
  }
}

function inputFixture(overrides: Partial<ImageProviderInput> = {}): ImageProviderInput {
  return {
    originalPrompt: "Create a small smoke-test image.",
    presetId: "none",
    prompt: "Create a small smoke-test image.",
    size: {
      width: 1024,
      height: 1024
    },
    sizeApiValue: "1024x1024",
    quality: "auto",
    outputFormat: "png",
    count: 1,
    ...overrides
  };
}

function editInputFixture(overrides: Partial<EditImageProviderInput> = {}): EditImageProviderInput {
  return {
    ...inputFixture(),
    referenceImages: [
      {
        dataUrl: `data:image/png;base64,${tinyPngBase64}`,
        fileName: "reference.png"
      }
    ],
    ...overrides
  };
}

function providerResult(size: string): ProviderResult {
  return {
    model: "fake-image-model",
    size,
    images: [
      {
        b64Json: tinyPngBase64
      }
    ]
  };
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

await main();
