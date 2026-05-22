import type { Hono } from "hono";
import {
  batchDeleteVideoOutputs,
  deleteVideoOutput,
  getVideoJob,
  getVideoLibrary,
  getVideoProviderStatusResponse,
  runVideoGeneration
} from "../../domain/video/video-generation.js";
import { getConfiguredVideoProvider, VideoProviderError } from "../../infrastructure/providers/video-provider.js";
import { errorResponse } from "../http/errors.js";
import { readJson } from "../http/json.js";
import { parseVideoBatchDeletePayload, parseVideoGeneratePayload } from "../http/validation.js";

export function registerVideoRoutes(app: Hono): void {
  app.get("/api/videos/provider-status", (c) => c.json(getVideoProviderStatusResponse()));

  app.get("/api/videos", (c) => c.json(getVideoLibrary()));

  app.post("/api/videos/generate", async (c) => {
    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    const parsed = parseVideoGeneratePayload(payload.value);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    const configuredProvider = getConfiguredVideoProvider();
    if (!configuredProvider.ok) {
      return videoProviderErrorJson(configuredProvider.error);
    }
    if (
      (parsed.value.mode === "text_to_video" && !configuredProvider.status.supportsTextToVideo) ||
      (parsed.value.mode === "image_to_video" && !configuredProvider.status.supportsImageToVideo)
    ) {
      return videoProviderErrorJson(
        new VideoProviderError(
          "unsupported_video_mode",
          `The configured video provider does not support ${parsed.value.mode}.`,
          400
        )
      );
    }

    try {
      return c.json(await runVideoGeneration(parsed.value, configuredProvider.provider));
    } catch (error) {
      if (error instanceof VideoProviderError) {
        return videoProviderErrorJson(error);
      }

      throw error;
    }
  });

  app.get("/api/videos/:jobId", (c) => {
    const job = getVideoJob(c.req.param("jobId"));
    if (!job) {
      return c.json(errorResponse("not_found", "Video generation job was not found."), 404);
    }

    return c.json(job);
  });

  app.post("/api/videos/batch-delete", async (c) => {
    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    const parsed = parseVideoBatchDeletePayload(payload.value);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    return c.json(await batchDeleteVideoOutputs(parsed.value.outputIds));
  });

  app.delete("/api/videos/:outputId", async (c) => {
    const deleted = await deleteVideoOutput(c.req.param("outputId"));
    if (deleted === "not_found") {
      return c.json(errorResponse("not_found", "Video output was not found."), 404);
    }
    if (deleted === "skipped") {
      return c.json(errorResponse("video_output_in_progress", "Queued or running video outputs cannot be deleted."), 409);
    }
    if (deleted === "failed") {
      return c.json(errorResponse("video_output_delete_failed", "Video output could not be deleted."), 500);
    }

    return c.json({
      ok: true
    });
  });
}

function videoProviderErrorJson(error: VideoProviderError): Response {
  return new Response(JSON.stringify(errorResponse(error.code, error.message)), {
    status: providerHttpStatus(error.status),
    headers: {
      "Content-Type": "application/json"
    }
  });
}

function providerHttpStatus(status: number): number {
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502;
}
