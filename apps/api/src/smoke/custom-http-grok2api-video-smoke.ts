import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import type { VideoGenerationJobResponse } from "../domain/contracts.js";

const dataDir = resolve(process.cwd(), ".codex-temp", `custom-http-grok2api-video-smoke-${randomUUID()}`);
process.env.DATA_DIR = dataDir;
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";
process.env.VIDEO_PROVIDER_KIND = "";
process.env.VIDEO_PROVIDER_URL = "";
process.env.VIDEO_PROVIDER_MODEL = "";
process.env.VIDEO_PROVIDER_TEXT_TO_VIDEO_URL = "";
process.env.VIDEO_PROVIDER_IMAGE_TO_VIDEO_URL = "";
process.env.VIDEO_PROVIDER_STATUS_URL = "";
process.env.VIDEO_PROVIDER_API_KEY = "";
process.env.VIDEO_PROVIDER_DOWNLOAD_PROXY_URL = "";
process.env.HTTP_PROXY = "";
process.env.HTTPS_PROXY = "";
process.env.ALL_PROXY = "";
process.env.http_proxy = "";
process.env.https_proxy = "";
process.env.all_proxy = "";

const fakeApiKey = "test-grok2api-video-key";
const fakeVideoBytes = Buffer.from("fake grok2api mp4 bytes", "utf8");

async function main(): Promise<void> {
  const upstream = await startFakeGrok2ApiServer();
  const { closeDatabase } = await import("../infrastructure/database.js");
  const { saveProviderConfig } = await import("../domain/providers/provider-config.js");
  const { getVideoProviderStatus } = await import("../infrastructure/providers/video-provider.js");
  const { agentWebSocketServer, createApp } = await import("../server/app.js");

  try {
    saveProviderConfig({
      sourceOrder: ["local-openai", "env-openai", "codex"],
      video: {
        kind: "custom-http",
        apiKey: fakeApiKey,
        baseUrl: upstream.baseUrl,
        videoModel: "grok-imagine-video",
        pollIntervalMs: 10,
        timeoutMs: 5_000
      }
    });

    const providerStatus = getVideoProviderStatus();
    expect(providerStatus.id === "custom-http", "configured provider uses the custom HTTP provider");
    expect(providerStatus.configured === true, "custom HTTP video provider is configured");
    expect(providerStatus.supportsTextToVideo === true, "custom HTTP video provider supports text-to-video");

    const app = createApp();
    const created = await app.request("/api/videos/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt: "A bright metro station hyperlapse",
        mode: "text_to_video",
        durationSeconds: 5,
        aspectRatio: "16:9",
        providerKind: "custom-http"
      })
    });
    expect(created.status === 200, `video generation request succeeds, got ${created.status}`);
    const createdBody = (await created.json()) as VideoGenerationJobResponse;
    const completed = await waitForVideoJob(app, createdBody.job.id, () => `upstream calls: ${JSON.stringify(upstream.calls)}`);

    expect(completed.job.status === "succeeded", `grok2api custom HTTP job succeeds; error: ${completed.job.error ?? "none"}`);
    expect(completed.job.provider === "custom-http", "video job records the custom HTTP provider");
    expect(completed.job.outputs[0]?.providerJobId === "video-smoke-grok2api", "video output exposes the grok2api video id");
    expect(completed.job.outputs[0]?.asset?.mimeType === "video/mp4", "video output asset is mp4");
    expect(upstream.calls.create === 1, "provider posts one grok2api create request");
    expect(upstream.calls.status >= 1, "provider polls grok2api status");
    expect(upstream.calls.content === 1, "provider downloads grok2api video content");

    console.log("custom HTTP grok2api video smoke checks passed");
  } finally {
    closeWebSocketServer(agentWebSocketServer);
    closeDatabase();
    await upstream.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}

async function waitForVideoJob(
  app: {
    request: (path: string, init?: RequestInit) => Response | Promise<Response>;
  },
  jobId: string,
  diagnostics: () => string
): Promise<VideoGenerationJobResponse> {
  let lastJobStatus = "missing";
  let lastJobError = "";
  let lastJobProgress = "";
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await app.request(`/api/videos/${jobId}`);
    expect(response.status === 200, "video job status request succeeds");
    const body = (await response.json()) as VideoGenerationJobResponse;
    lastJobStatus = body.job.status;
    lastJobError = body.job.error ?? "";
    lastJobProgress = `${body.job.progressPercent}% ${body.job.progressStage} ${body.job.progressMessage ?? ""}`;
    if (body.job.status === "succeeded" || body.job.status === "failed") {
      return body;
    }
    await delay(50);
  }

  throw new Error(
    `Video job did not complete in time. Last status: ${lastJobStatus}${lastJobError ? ` (${lastJobError})` : ""}; ${lastJobProgress}; ${diagnostics()}.`
  );
}

async function startFakeGrok2ApiServer(): Promise<{
  baseUrl: string;
  calls: {
    create: number;
    status: number;
    content: number;
  };
  close: () => Promise<void>;
}> {
  const calls = {
    create: 0,
    status: 0,
    content: 0
  };

  const server = createServer(async (request, response) => {
    try {
      if (request.method === "POST" && request.url === "/v1/videos") {
        calls.create += 1;
        expectBearerAuth(request);
        const body = await readRequestBody(request);
        const contentType = request.headers["content-type"] ?? "";
        expect(contentType.includes("multipart/form-data"), "grok2api create request uses multipart form data");
        expect(body.includes('name="model"'), "grok2api create request includes model field");
        expect(body.includes("grok-imagine-video"), "grok2api create request sends configured model");
        expect(body.includes('name="prompt"'), "grok2api create request includes prompt field");
        expect(body.includes("A bright metro station hyperlapse"), "grok2api create request sends prompt");
        expect(body.includes('name="seconds"'), "grok2api create request includes seconds field");
        expect(body.includes("5"), "grok2api create request sends requested seconds");
        expect(body.includes('name="size"'), "grok2api create request includes size field");
        expect(body.includes("1280x720"), "grok2api create request sends video size");
        expect(body.includes('name="resolution_name"'), "grok2api create request includes resolution_name field");
        expect(body.includes("720p"), "grok2api create request sends resolution_name");
        expect(body.includes('name="preset"'), "grok2api create request includes preset field");
        expect(body.includes("custom"), "grok2api create request sends custom preset");
        writeJson(response, 200, {
          id: "video-smoke-grok2api",
          status: "queued"
        });
        return;
      }

      if (request.method === "GET" && request.url === "/v1/videos/video-smoke-grok2api") {
        calls.status += 1;
        expectBearerAuth(request);
        writeJson(response, 200, {
          id: "video-smoke-grok2api",
          status: "completed",
          progress: 100
        });
        return;
      }

      if (request.method === "GET" && request.url === "/v1/videos/video-smoke-grok2api/content") {
        calls.content += 1;
        expectBearerAuth(request);
        response.writeHead(200, {
          "Content-Type": "video/mp4",
          "Content-Length": String(fakeVideoBytes.length)
        });
        response.end(fakeVideoBytes);
        return;
      }

      writeJson(response, 404, {
        error: {
          message: `Unexpected fake grok2api request: ${request.method ?? "GET"} ${request.url ?? "/"}`
        }
      });
    } catch (error) {
      writeJson(response, 500, {
        error: {
          message: error instanceof Error ? error.message : "Fake upstream failed."
        }
      });
    }
  });

  await new Promise<void>((resolveListen) => {
    server.listen(0, "127.0.0.1", resolveListen);
  });

  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    calls,
    close: () =>
      new Promise((resolveClose, rejectClose) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error) {
            rejectClose(error);
            return;
          }
          resolveClose();
        });
      })
  };
}

function expectBearerAuth(request: IncomingMessage): void {
  const authorization = request.headers.authorization;
  expect(authorization === `Bearer ${fakeApiKey}`, "grok2api request includes bearer auth");
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveRead, rejectRead) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("error", rejectRead);
    request.on("end", () => {
      resolveRead(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": String(payload.length)
  });
  response.end(payload);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function closeWebSocketServer(server: { close: () => void }): void {
  server.close();
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
