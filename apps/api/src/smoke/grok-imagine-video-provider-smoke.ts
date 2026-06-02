import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import type { VideoGenerationJobResponse, VideoLibraryResponse } from "../domain/contracts.js";

const dataDir = resolve(process.cwd(), ".codex-temp", `grok-imagine-video-provider-smoke-${randomUUID()}`);
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

const fakeApiKey = "test-grok-imagine-video-key";
const fakeVideoBytes = Buffer.from("fake grok imagine mp4 bytes", "utf8");
const fakeDownloadUrl = "http://video-cdn.example.test/grok-imagine-smoke.mp4";

async function main(): Promise<void> {
  const upstream = await startFakeGrokImagineServer();
  const downloadProxy = await startFakeDownloadProxy();
  const { closeDatabase } = await import("../infrastructure/database.js");
  const { getProviderConfig, saveProviderConfig } = await import("../domain/providers/provider-config.js");
  const { getVideoProviderStatus } = await import("../infrastructure/providers/video-provider.js");
  const { agentWebSocketServer, createApp } = await import("../server/app.js");

  try {
    process.env.HTTP_PROXY = downloadProxy.proxyUrl;
    process.env.HTTPS_PROXY = downloadProxy.proxyUrl;
    process.env.VIDEO_PROVIDER_KIND = "keyframe-image";
    process.env.OPENAI_API_KEY = "test-env-openai-key";

    const grokActiveConfig = saveProviderConfig({
      sourceOrder: ["local-openai", "env-openai", "codex"],
      video: {
        kind: "grok-imagine",
        apiKey: fakeApiKey,
        baseUrl: upstream.baseUrl,
        videoModel: "grok-imagine-video",
        pollIntervalMs: 10,
        timeoutMs: 5_000
      }
    });
    expect(grokActiveConfig.video.kind === "grok-imagine", "saved Grok Imagine remains the active video provider despite env keyframe config");
    const providerStatus = getVideoProviderStatus();
    expect(providerStatus.id === "grok-imagine", "configured video provider uses Grok Imagine");
    expect(providerStatus.configured === true, "Grok Imagine video provider is configured");
    expect(providerStatus.supportsTextToVideo === true, "Grok Imagine video provider supports text-to-video");

    const app = createApp();
    const activeConfig = getProviderConfig();
    expect(activeConfig.video.kind === "grok-imagine", "provider config reports saved Grok Imagine as active despite env keyframe config");

    const defaultStatusResponse = await app.request("/api/videos/provider-status");
    expect(defaultStatusResponse.status === 200, "default provider status request succeeds");
    const defaultStatus = (await defaultStatusResponse.json()) as { provider?: { id?: string; configured?: boolean } };
    expect(defaultStatus.provider?.id === "grok-imagine", "default provider status uses saved active Grok Imagine config");
    expect(defaultStatus.provider.configured === true, "default Grok Imagine provider status is configured");

    const defaultCreated = await app.request("/api/videos/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt: "A crystal subway train arriving under moonlight",
        mode: "text_to_video",
        durationSeconds: 5,
        aspectRatio: "16:9"
      })
    });
    expect(defaultCreated.status === 200, `default video generation request succeeds, got ${defaultCreated.status}`);
    const defaultCreatedBody = (await defaultCreated.json()) as VideoGenerationJobResponse;
    expect(defaultCreatedBody.job.provider === "grok-imagine", "default video generation records Grok Imagine provider");
    await waitForVideoJob(app, defaultCreatedBody.job.id, () => `upstream calls: ${JSON.stringify(upstream.calls)}`);

    const keyframeActiveConfig = saveProviderConfig({
      sourceOrder: ["local-openai", "env-openai", "codex"],
      video: {
        kind: "keyframe-image",
        apiKey: "test-keyframe-video-key",
        baseUrl: "https://images.example.test/v1",
        width: 3840,
        height: 2160,
        fps: 24,
        interpolation: "ffmpeg"
      }
    });
    expect(keyframeActiveConfig.video.kind === "keyframe-image", "local active video config switches away from Grok Imagine");
    expect(getProviderConfig().videoConfigs["grok-imagine"].apiKey.hasSecret === true, "inactive Grok Imagine config is still saved");

    const overrideStatusResponse = await app.request("/api/videos/provider-status?providerKind=grok-imagine");
    expect(overrideStatusResponse.status === 200, "provider status override request succeeds");
    const overrideStatus = (await overrideStatusResponse.json()) as { provider?: { id?: string; configured?: boolean } };
    expect(overrideStatus.provider?.id === "grok-imagine", "request-level provider status override uses local Grok Imagine config");
    expect(overrideStatus.provider.configured === true, "request-level Grok Imagine provider status is configured");

    const created = await app.request("/api/videos/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt: "A crystal subway train arriving under moonlight",
        mode: "text_to_video",
        durationSeconds: 5,
        aspectRatio: "16:9",
        providerKind: "grok-imagine"
      })
    });
    expect(created.status === 200, `video generation request succeeds, got ${created.status}`);
    const createdBody = (await created.json()) as VideoGenerationJobResponse;
    expect(Boolean(createdBody.job.id), "video generation returns a job id");

    const completed = await waitForVideoJob(app, createdBody.job.id, () => `upstream calls: ${JSON.stringify(upstream.calls)}`);
    expect(
      completed.job.status === "succeeded",
      `grok imagine video job succeeds; error: ${completed.job.error ?? "none"}; ${JSON.stringify(upstream.calls)}`
    );
    expect(completed.job.provider === "grok-imagine", "saved video job records the grok imagine provider");
    expect(completed.job.outputs.length === 1, "video job has one output");
    const completedOutput = completed.job.outputs[0];
    expect(completedOutput, "video job has a completed output");
    expect(completedOutput.status === "succeeded", "video output succeeds");
    expect(completedOutput.providerJobId === "task-smoke-grok-imagine", "video output exposes the remote Grok Imagine task id");
    expect(completedOutput.asset?.mimeType === "video/mp4", "video output asset is mp4");

    const libraryResponse = await app.request("/api/videos");
    expect(libraryResponse.status === 200, "video library request succeeds");
    const library = (await libraryResponse.json()) as VideoLibraryResponse;
    const item = library.items.find((candidate) => candidate.generationId === createdBody.job.id);
    expect(item, "saved video appears in the Video Library");
    expect(item.status === "succeeded", "Video Library item is succeeded");
    expect(item.providerJobId === "task-smoke-grok-imagine", "Video Library item exposes the remote Grok Imagine task id");
    expect(item.asset?.mimeType === "video/mp4", "Video Library item has a video asset");

    const assetResponse = await app.request(item.asset.url);
    expect(assetResponse.status === 200, "saved video asset is downloadable");
    expect(Buffer.from(await assetResponse.arrayBuffer()).equals(fakeVideoBytes), "downloaded saved asset matches upstream video bytes");

    expect(upstream.calls.create === 2, "provider posts one default and one override Grok Imagine create request");
    expect(upstream.calls.status >= 1, "provider polls Grok Imagine status");
    expect(downloadProxy.calls.download === 4, "provider retries transient video downloads through environment proxy settings");
    expect(downloadProxy.calls.leakedAuthorization === 0, "provider does not forward API bearer auth to external video download URLs");

    console.log("grok imagine video provider smoke checks passed");
  } finally {
    await closeWebSocketServer(agentWebSocketServer);
    closeDatabase();
    await upstream.close();
    await downloadProxy.close();
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
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const response = await app.request(`/api/videos/${jobId}`);
    expect(response.status === 200, "video job status request succeeds");
    const body = (await response.json()) as VideoGenerationJobResponse;
    lastJobStatus = body.job.status;
    lastJobError = body.job.error ?? "";
    lastJobProgress = `${body.job.progressPercent}% ${body.job.progressStage} ${body.job.progressMessage ?? ""} outputTask=${body.job.outputs[0]?.providerJobId ?? ""}`;
    if (body.job.status === "succeeded" || body.job.status === "failed") {
      return body;
    }
    await delay(50);
  }

  throw new Error(
    `Video job did not complete in time. Last status: ${lastJobStatus}${lastJobError ? ` (${lastJobError})` : ""}; ${lastJobProgress}; ${diagnostics()}.`
  );
}

async function startFakeGrokImagineServer(): Promise<{
  baseUrl: string;
  calls: {
    create: number;
    status: number;
  };
  close: () => Promise<void>;
}> {
  const calls = {
    create: 0,
    status: 0
  };

  const server = createServer(async (request, response) => {
    try {
      if (request.method === "POST" && request.url === "/v1/videos") {
        calls.create += 1;
        expectBearerAuth(request);
        const body = await readJson(request);
        expect(body.model === "grok-imagine-video", "Grok Imagine create request includes configured model");
        expect(body.prompt === "A crystal subway train arriving under moonlight", "Grok Imagine create request includes prompt");
        expect(body.seconds === "5", "Grok Imagine create request sends seconds as a string");
        expect(body.size === "1280x720", "Grok Imagine create request sends size as a widthxheight string");
        writeJson(response, 200, {
          id: "task-smoke-grok-imagine",
          task_id: "task-smoke-grok-imagine",
          object: "video",
          model: "grok-imagine-video",
          status: "queued",
          progress: 0,
          seconds: "5",
          size: "1280x720"
        });
        return;
      }

      if (request.method === "GET" && request.url === "/v1/videos/task-smoke-grok-imagine") {
        calls.status += 1;
        expectBearerAuth(request);
        writeJson(response, 200, {
          status: "done",
          model: "grok-imagine-video",
          progress: 100,
          video: {
            url: fakeDownloadUrl,
            duration: 5
          }
        });
        return;
      }

      writeJson(response, 404, {
        error: {
          message: `Unexpected fake Grok Imagine request: ${request.method ?? "GET"} ${request.url ?? "/"}`
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
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
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

async function startFakeDownloadProxy(): Promise<{
  proxyUrl: string;
  calls: {
    download: number;
    leakedAuthorization: number;
  };
  close: () => Promise<void>;
}> {
  const calls = {
    download: 0,
    leakedAuthorization: 0
  };

  const server = createServer((request, response) => {
    if (request.headers.authorization) {
      calls.leakedAuthorization += 1;
    }

    if (request.method === "GET" && request.url === fakeDownloadUrl) {
      calls.download += 1;
      if (calls.download % 2 === 1) {
        writeJson(response, 503, {
          error: {
            message: "Transient video CDN failure."
          }
        });
        return;
      }

      response.writeHead(200, {
        "Content-Type": "video/mp4",
        "Content-Length": String(fakeVideoBytes.length)
      });
      response.end(fakeVideoBytes);
      return;
    }

    writeJson(response, 502, {
      error: {
        message: `Unexpected fake proxy request: ${request.method ?? "GET"} ${request.url ?? "/"}`
      }
    });
  });

  await new Promise<void>((resolveListen) => {
    server.listen(0, "127.0.0.1", resolveListen);
  });

  const address = server.address() as AddressInfo;

  return {
    proxyUrl: `http://127.0.0.1:${address.port}`,
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
  expect(authorization === `Bearer ${fakeApiKey}`, "Grok Imagine request includes bearer auth");
}

function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolveRead, rejectRead) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("error", rejectRead);
    request.on("end", () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
        expect(isRecord(parsed), "request body is a JSON object");
        resolveRead(parsed);
      } catch (error) {
        rejectRead(error);
      }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
