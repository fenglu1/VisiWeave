import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const dataDir = resolve(process.cwd(), ".codex-temp", `request-logs-smoke-${randomUUID()}`);
process.env.DATA_DIR = dataDir;
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";

const { closeDatabase } = await import("../infrastructure/database.js");
const { saveAgentLlmConfig } = await import("../domain/agent/config.js");
const { getProviderConfig, saveProviderConfig } = await import("../domain/providers/provider-config.js");
const {
  cleanupExpiredRequestLogs,
  listProviderRequestLogs,
  recordProviderRequestLog
} = await import("../domain/request-logs/request-log-store.js");
const { app } = await import("../server/app.js");

const sourceOrder = ["local-openai", "env-openai", "codex"] as const;
const secret = "fake-request-log-secret";

async function main(): Promise<void> {
  const initialConfig = getProviderConfig();
  expect(initialConfig.requestLogging.image === false, "image request logging defaults off");
  expect(initialConfig.requestLogging.video === false, "video request logging defaults off");

  await recordProviderRequestLog({
    service: "image",
    category: "text_to_image",
    providerKind: "gemini",
    method: "POST",
    url: "https://relay.example.test/v1beta/models",
    requestHeaders: {
      Authorization: `Bearer ${secret}`
    },
    requestBody: {
      prompt: "not recorded"
    }
  });
  expect(listProviderRequestLogs().items.length === 0, "logging is ignored while the image toggle is off");

  const saved = saveProviderConfig({
    sourceOrder: [...sourceOrder],
    requestLogging: {
      image: true,
      video: false
    }
  });
  expect(saved.requestLogging.image === true, "image logging toggle is persisted");
  expect(saved.requestLogging.video === false, "video logging toggle remains independent");

  await recordProviderRequestLog({
    service: "image",
    category: "text_to_image",
    providerKind: "gemini",
    method: "POST",
    url: "https://relay.example.test/v1beta/models?model=openai/gpt-image-2",
    requestHeaders: {
      Authorization: `Bearer ${secret}`,
      "x-goog-api-key": secret
    },
    requestBody: {
      apiKey: secret,
      prompt: "draw a poster",
      image: `data:image/png;base64,${"A".repeat(300)}`
    },
    responseStatus: 502,
    responseBodyPreview: {
      error: `Bearer ${secret}`
    },
    durationMs: 42
  });

  const imageLogs = listProviderRequestLogs({ service: "image" });
  expect(imageLogs.items.length === 1, "enabled image logging records a request");
  expect(imageLogs.items[0]?.path.includes("model=openai/gpt-image-2"), "request paths are kept intact for debugging");
  expect(!JSON.stringify(imageLogs).includes(secret), "raw keys never appear in listed logs");
  expect(JSON.stringify(imageLogs).includes("[DATA_URL"), "data URLs are collapsed in request bodies");

  const routeResponse = await app.request("/api/request-logs?service=image");
  const routeBody = (await routeResponse.json()) as { items?: unknown[]; retentionHours?: number };
  expect(routeResponse.status === 200, "request log list route succeeds");
  expect(routeBody.retentionHours === 6, "request log list route reports the retention window");
  expect(routeBody.items?.length === 1, "request log list route returns recorded items");
  expect(!JSON.stringify(routeBody).includes(secret), "request log API response is redacted");

  saveAgentLlmConfig({
    apiKey: "fake-agent-log-secret",
    baseUrl: "https://agent.example.test/v1",
    model: "deepseek-chat",
    timeoutMs: 60000,
    supportsVision: false,
    requestLoggingEnabled: true
  });
  await recordProviderRequestLog({
    service: "agent",
    category: "agent",
    providerKind: "agent",
    method: "POST",
    url: "https://agent.example.test/v1/chat/completions",
    requestHeaders: {
      Authorization: "Bearer fake-agent-log-secret"
    },
    requestBody: {
      model: "deepseek-chat",
      messages: [{ role: "user", content: "plan" }]
    },
    responseStatus: 200
  });
  expect(listProviderRequestLogs({ service: "agent" }).items.length === 1, "Agent logging is controlled by its own toggle");

  cleanupExpiredRequestLogs(new Date(Date.now() + 7 * 60 * 60 * 1000));
  expect(listProviderRequestLogs().items.length === 0, "request logs expire after the six-hour retention window");

  console.log("request logs smoke checks passed");
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
