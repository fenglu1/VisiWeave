import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { EditImageProviderInput, ImageProviderInput, OpenAIImageProviderConfig } from "../infrastructure/providers/image-provider.js";

const dataDir = resolve(process.cwd(), ".codex-temp", `image-provider-format-smoke-${randomUUID()}`);
process.env.DATA_DIR = dataDir;
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

const { closeDatabase } = await import("../infrastructure/database.js");
const { getProviderConfig, saveProviderConfig } = await import("../domain/providers/provider-config.js");
const { createOpenAIImageProvider } = await import("../infrastructure/providers/image-provider.js");

async function main(): Promise<void> {
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_IMAGE_PROVIDER_FORMAT;

  const initialConfig = getProviderConfig();
  expect(initialConfig.localOpenAI.imageProviderFormat === "newapi", "default local image provider format is newapi");

  const saved = saveProviderConfig({
    sourceOrder: ["local-openai", "env-openai", "codex"],
    localOpenAI: {
      apiKey: "test-sub2api-key",
      baseUrl: " https://sub2api.example.test ",
      model: "gpt-image-2",
      timeoutMs: 120000,
      imageProviderFormat: "sub2api"
    }
  });

  expect(saved.localOpenAI.imageProviderFormat === "sub2api", "saved local image provider format is returned");
  expect(saved.sources.find((source) => source.id === "local-openai")?.details.imageProviderFormat === "sub2api", "local source exposes image provider format");
  expect(!JSON.stringify(saved).includes("test-sub2api-key"), "saved local image provider key is never exposed");

  const requests: Array<{
    body?: Record<string, unknown>;
    bodyKind: "form" | "json" | "none";
    method: string;
    url: string;
  }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const bodyKind = init?.body instanceof FormData ? "form" : init?.body ? "json" : "none";
    requests.push({
      url,
      method: init?.method ?? "GET",
      bodyKind,
      body: bodyKind === "json" ? (JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>) : undefined
    });

    return new Response(
      url.endsWith("/v1/images/edits")
        ? `data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"${tinyPngBase64}"}}\n\n` +
            `data: {"type":"response.completed","response":{"output":[]}}\n\n`
        : `data: {"type":"response.image_generation_call.partial_image","partial_image_b64":"${tinyPngBase64}"}\n\n` +
            `data: {"type":"image_generation.completed"}\n\n`,
      {
        status: 200,
        headers: {
          "content-type": "text/event-stream"
        }
      }
    );
  };

  try {
    const provider = createOpenAIImageProvider({
      apiKey: "test-sub2api-key",
      baseURL: "https://sub2api.example.test",
      model: "gpt-image-2",
      timeoutMs: 120000,
      imageProviderFormat: "sub2api"
    } satisfies OpenAIImageProviderConfig);
    const result = await provider.generate(inputFixture());
    const generateRequest = requests.find((request) => request.url === "https://sub2api.example.test/v1/images/generations");

    expect(generateRequest?.url === "https://sub2api.example.test/v1/images/generations", "sub2api text generation uses the images generations endpoint");
    expect(generateRequest.method === "POST", "sub2api text generation uses POST");
    expect(generateRequest.bodyKind === "json", "sub2api text generation sends JSON");
    expect(generateRequest.body?.model === "gpt-image-2", "sub2api text generation keeps the configured gpt-image-2 model");
    expect(generateRequest.body?.stream === true, "sub2api text generation enables streaming");
    expect(generateRequest.body?.response_format === "b64_json", "sub2api text generation requests base64 responses");
    expect(generateRequest.body?.partial_images === 1, "sub2api text generation asks for partial image events");
    expect(result.images.length === 1, "sub2api stream returns one final image");
    expect(result.images[0]?.b64Json === tinyPngBase64, "sub2api stream falls back to the last partial image candidate");

    const editResult = await provider.edit(editInputFixture());
    const editRequest = requests.find((request) => request.url === "https://sub2api.example.test/v1/images/edits");
    expect(editRequest?.url === "https://sub2api.example.test/v1/images/edits", "sub2api edit generation uses the images edits endpoint");
    expect(editRequest.method === "POST", "sub2api edit generation uses POST");
    expect(editRequest.bodyKind === "form", "sub2api edit generation sends multipart form data");
    expect(editResult.images.length === 1, "sub2api edit stream returns one final image");
    expect(editResult.images[0]?.b64Json === tinyPngBase64, "sub2api edit stream uses output item image data");
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("image provider format smoke checks passed");
}

function editInputFixture(): EditImageProviderInput {
  return {
    ...inputFixture(),
    referenceImages: [
      {
        dataUrl: `data:image/png;base64,${tinyPngBase64}`,
        fileName: "reference.png"
      }
    ]
  };
}

function inputFixture(): ImageProviderInput {
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
    count: 1
  };
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  await main();
} finally {
  closeDatabase();
  await rm(dataDir, { recursive: true, force: true });
}
