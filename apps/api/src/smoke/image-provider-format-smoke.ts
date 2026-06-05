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
const { getLocalOpenAIImageProviderConfig, getProviderConfig, saveProviderConfig } = await import("../domain/providers/provider-config.js");
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

  const multiSaved = saveProviderConfig({
    sourceOrder: ["local-openai", "env-openai", "codex"],
    imageConfigs: {
      newapi: {
        apiKey: "test-newapi-key",
        baseUrl: "https://newapi.example.test",
        model: "gpt-image-2",
        timeoutMs: 120000,
        imageProviderFormat: "newapi"
      },
      sub2api: {
        apiKey: "test-sub2api-second-key",
        baseUrl: "https://sub2api-second.example.test",
        model: "gpt-image-2",
        timeoutMs: 180000,
        imageProviderFormat: "sub2api"
      },
      gemini: {
        apiKey: "test-gemini-config-key",
        baseUrl: "https://generativelanguage.example.test",
        model: "gemini-2.5-flash-image",
        timeoutMs: 240000,
        imageProviderFormat: "gemini"
      }
    },
    localOpenAI: {
      apiKey: "",
      preserveApiKey: true,
      baseUrl: "https://generativelanguage.example.test",
      model: "gemini-2.5-flash-image",
      timeoutMs: 240000,
      imageProviderFormat: "gemini"
    }
  });

  expect(multiSaved.localOpenAI.imageProviderFormat === "gemini", "active local image adapter can be Gemini");
  expect(multiSaved.imageConfigs.newapi.apiKey.hasSecret, "newapi keeps its independent API key");
  expect(multiSaved.imageConfigs.sub2api.apiKey.hasSecret, "sub2api keeps its independent API key");
  expect(multiSaved.imageConfigs.gemini.apiKey.hasSecret, "gemini keeps its independent API key");
  expect(multiSaved.imageConfigs.newapi.baseUrl === "https://newapi.example.test", "newapi keeps its independent base URL");
  expect(multiSaved.imageConfigs.sub2api.baseUrl === "https://sub2api-second.example.test", "sub2api keeps its independent base URL");
  expect(multiSaved.imageConfigs.gemini.baseUrl === "https://generativelanguage.example.test", "gemini keeps its independent base URL");
  expect(!JSON.stringify(multiSaved).includes("test-newapi-key"), "newapi raw key is never exposed");
  expect(!JSON.stringify(multiSaved).includes("test-sub2api-second-key"), "sub2api raw key is never exposed");
  expect(!JSON.stringify(multiSaved).includes("test-gemini-config-key"), "gemini raw key is never exposed");

  const selectedLocalConfig = getLocalOpenAIImageProviderConfig();
  expect(selectedLocalConfig?.imageProviderFormat === "gemini", "runtime local provider selection uses the active Gemini adapter");
  expect(selectedLocalConfig.apiKey === "test-gemini-config-key", "runtime Gemini adapter uses Gemini's own API key");
  expect(selectedLocalConfig.baseURL === "https://generativelanguage.example.test", "runtime Gemini adapter uses Gemini's own base URL");

  const requests: Array<{
    body?: Record<string, unknown>;
    bodyKind: "form" | "json" | "none";
    headers: Record<string, string>;
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
      headers: requestHeaders(init?.headers),
      bodyKind,
      body: bodyKind === "json" ? (JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>) : undefined
    });

    return new Response(
      url.includes(":generateContent")
        ? JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    { text: "done" },
                    {
                      inlineData: {
                        mimeType: "image/png",
                        data: `data:image/png;base64,${tinyPngBase64}`
                      }
                    }
                  ]
                }
              }
            ]
          })
        : url.endsWith("/v1/images/edits")
        ? `data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"${tinyPngBase64}"}}\n\n` +
          `data: {"type":"response.completed","response":{"output":[]}}\n\n`
        : `data: {"type":"response.image_generation_call.partial_image","partial_image_b64":"${tinyPngBase64}"}\n\n` +
          `data: {"type":"image_generation.completed"}\n\n`,
      {
        status: 200,
        headers: {
          "content-type": url.includes(":generateContent") ? "application/json" : "text/event-stream"
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

    requests.length = 0;
    const geminiProvider = createOpenAIImageProvider({
      apiKey: "test-gemini-key",
      baseURL: "https://generativelanguage.example.test",
      model: "gemini-2.5-flash-image",
      timeoutMs: 120000,
      imageProviderFormat: "gemini" as OpenAIImageProviderConfig["imageProviderFormat"]
    } satisfies OpenAIImageProviderConfig);

    const geminiResult = await geminiProvider.generate(inputFixture());
    const geminiGenerateRequest = requests.find(
      (request) => request.url === "https://generativelanguage.example.test/v1beta/models/gemini-2.5-flash-image:generateContent"
    );
    expect(
      geminiGenerateRequest?.url === "https://generativelanguage.example.test/v1beta/models/gemini-2.5-flash-image:generateContent",
      "gemini text generation uses the generateContent endpoint"
    );
    expect(geminiGenerateRequest.method === "POST", "gemini text generation uses POST");
    expect(geminiGenerateRequest.headers["content-type"] === "application/json", "gemini text generation sends JSON");
    expect(geminiGenerateRequest.headers["x-goog-api-key"] === "test-gemini-key", "gemini text generation sends x-goog-api-key");
    expect(geminiGenerateRequest.bodyKind === "json", "gemini text generation sends a JSON body");
    expect(
      JSON.stringify(Object.keys(geminiGenerateRequest.body ?? {}).sort()) === JSON.stringify(["contents", "generationConfig"]),
      "gemini text generation only sends contents and generationConfig"
    );
    expect(!Object.hasOwn(geminiGenerateRequest.body ?? {}, "model"), "gemini text generation does not send OpenAI model in the body");
    expect(!Object.hasOwn(geminiGenerateRequest.body ?? {}, "size"), "gemini text generation does not send OpenAI size");
    expect(!Object.hasOwn(geminiGenerateRequest.body ?? {}, "quality"), "gemini text generation does not send OpenAI quality");
    expect(!Object.hasOwn(geminiGenerateRequest.body ?? {}, "output_format"), "gemini text generation does not send OpenAI output_format");
    expect(!Object.hasOwn(geminiGenerateRequest.body ?? {}, "n"), "gemini text generation does not send OpenAI count");
    expect(
      JSON.stringify(geminiGenerateRequest.body?.generationConfig) === JSON.stringify({ responseModalities: ["TEXT", "IMAGE"] }),
      "gemini text generation requests text and image response modalities"
    );
    expect(geminiResult.images.length === 1, "gemini JSON response returns one image");
    expect(geminiResult.images[0]?.b64Json === tinyPngBase64, "gemini response strips a data URL image result to base64");

    const geminiEditResult = await geminiProvider.edit(editInputFixture());
    const geminiRequests = requests.filter(
      (request) => request.url === "https://generativelanguage.example.test/v1beta/models/gemini-2.5-flash-image:generateContent"
    );
    const geminiEditRequest = geminiRequests[geminiRequests.length - 1];
    const geminiEditParts = geminiEditRequest?.body?.contents
      ? (((geminiEditRequest.body.contents as Record<string, unknown>[])[0]?.parts ?? []) as Record<string, unknown>[])
      : [];
    const inlineData = geminiEditParts.find((part) => typeof part.inlineData === "object")?.inlineData as
      | Record<string, unknown>
      | undefined;
    expect(geminiEditRequest?.method === "POST", "gemini edit generation uses POST");
    expect(inlineData?.mimeType === "image/png", "gemini edit preserves the reference MIME type");
    expect(inlineData?.data === tinyPngBase64, "gemini edit sends pure base64 image data without a data URL prefix");
    expect(geminiEditResult.images.length === 1, "gemini edit response returns one image");
    expect(geminiEditResult.images[0]?.b64Json === tinyPngBase64, "gemini edit parses inline image data");
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

function requestHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) {
    return result;
  }

  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      result[key.toLowerCase()] = value;
    });
    return result;
  }

  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      result[key.toLowerCase()] = value;
    }
    return result;
  }

  for (const [key, value] of Object.entries(headers)) {
    result[key.toLowerCase()] = value;
  }
  return result;
}

try {
  await main();
} finally {
  closeDatabase();
  await rm(dataDir, { recursive: true, force: true });
}
