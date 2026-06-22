import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const dataDir = resolve(process.cwd(), ".codex-temp", `provider-image-models-smoke-${randomUUID()}`);
process.env.DATA_DIR = dataDir;
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";

const { closeDatabase } = await import("../infrastructure/database.js");
const { saveProviderConfig } = await import("../domain/providers/provider-config.js");
const { app } = await import("../server/app.js");

async function main(): Promise<void> {
  saveProviderConfig({
    sourceOrder: ["local-openai", "env-openai", "codex"],
    imageConfigs: {
      gemini: {
        apiKey: "saved-gemini-relay-key",
        baseUrl: "https://relay.example.test/v1",
        model: "seedream/seedream-5-0",
        timeoutMs: 1200000,
        imageProviderFormat: "gemini"
      }
    },
    localOpenAI: {
      apiKey: "",
      preserveApiKey: true,
      baseUrl: "https://relay.example.test/v1",
      model: "seedream/seedream-5-0",
      timeoutMs: 1200000,
      imageProviderFormat: "gemini"
    }
  });

  const requests: Array<{ body?: Record<string, unknown>; headers: Record<string, string>; method: string; url: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: requestHeaders(init?.headers),
      body
    });

    return new Response(
      JSON.stringify({
        models: [
          {
            name: "models/vertex/anon-bob",
            displayName: "Anon Bob",
            supportedGenerationMethods: ["generateContent", "streamGenerateContent"]
          },
          {
            name: "models/seedream/seedream-5-0",
            displayName: "Seedream 5",
            supportedGenerationMethods: ["generateContent", "streamGenerateContent"]
          },
          {
            name: "models/openai/gpt-image-2",
            displayName: "GPT Image 2",
            supportedGenerationMethods: ["generateContent", "streamGenerateContent"]
          },
          {
            name: "models/text/chat-only",
            displayName: "Chat Only",
            supportedGenerationMethods: ["countTokens"]
          }
        ]
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      }
    );
  };

  try {
    const rejected = await app.request("/api/provider-config/image-models", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        kind: "newapi"
      })
    });
    expect(rejected.status === 400, "image model listing only supports Gemini");

    const response = await app.request("/api/provider-config/image-models", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        kind: "gemini",
        apiKey: "",
        preserveApiKey: true,
        baseUrl: "https://relay.example.test/v1",
        timeoutMs: 1200000
      })
    });

    const body = (await response.json()) as {
      defaultModel?: string;
      kind?: string;
      models?: Array<{ displayName: string; id: string }>;
    };

    expect(response.status === 200, "Gemini image model listing succeeds");
    expect(body.kind === "gemini", "Gemini image model listing returns the provider kind");
    expect(body.defaultModel === "openai/gpt-image-2", "Gemini image model listing prefers openai/gpt-image-2");
    expect(body.models?.length === 3, "Gemini image model listing filters models without generateContent support");
    expect(body.models?.[0]?.id === "vertex/anon-bob", "Gemini image model listing preserves Gemini model order");
    expect(!JSON.stringify(body).includes("saved-gemini-relay-key"), "Gemini image model listing never returns API keys");

    const upstreamRequest = requests.find((request) => request.url === "https://relay.example.test/v1beta/models");
    expect(upstreamRequest?.method === "GET", "Gemini image model listing calls the Gemini-compatible /v1beta/models endpoint");
    expect(upstreamRequest.headers.accept === "application/json", "Gemini image model listing accepts JSON");
    expect(upstreamRequest.headers["x-goog-api-key"] === "saved-gemini-relay-key", "Gemini image model listing uses Gemini model-list auth headers");
    expect(upstreamRequest.body === undefined, "Gemini image model listing does not send a relay JSON body");
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("provider image models smoke checks passed");
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
