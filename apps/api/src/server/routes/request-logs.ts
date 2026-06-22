import type { Hono } from "hono";
import type { RequestLogCategory, RequestLogService } from "../../domain/contracts.js";
import {
  deleteProviderRequestLogs,
  getProviderRequestLog,
  listProviderRequestLogs
} from "../../domain/request-logs/request-log-store.js";
import { errorResponse } from "../http/errors.js";

const REQUEST_LOG_SERVICES = new Set<RequestLogService>(["image", "video", "agent"]);
const REQUEST_LOG_CATEGORIES = new Set<RequestLogCategory>([
  "text_to_image",
  "image_to_image",
  "text_to_video",
  "image_to_video",
  "agent"
]);

export function registerRequestLogRoutes(app: Hono): void {
  app.get("/api/request-logs", (c) => {
    const service = parseRequestLogService(c.req.query("service"));
    const category = parseRequestLogCategory(c.req.query("category"));
    const limit = parseLimit(c.req.query("limit"));

    if (c.req.query("service") && !service) {
      return c.json(errorResponse("invalid_request_log_filter", "Request log service is invalid."), 400);
    }
    if (c.req.query("category") && !category) {
      return c.json(errorResponse("invalid_request_log_filter", "Request log category is invalid."), 400);
    }

    return c.json(listProviderRequestLogs({ service, category, limit }));
  });

  app.get("/api/request-logs/:id", (c) => {
    const item = getProviderRequestLog(c.req.param("id"));
    if (!item) {
      return c.json(errorResponse("not_found", "Request log was not found."), 404);
    }

    return c.json(item);
  });

  app.delete("/api/request-logs", (c) => {
    deleteProviderRequestLogs();
    return c.json({ ok: true });
  });
}

function parseRequestLogService(value: string | undefined): RequestLogService | undefined {
  return value && REQUEST_LOG_SERVICES.has(value as RequestLogService) ? (value as RequestLogService) : undefined;
}

function parseRequestLogCategory(value: string | undefined): RequestLogCategory | undefined {
  return value && REQUEST_LOG_CATEGORIES.has(value as RequestLogCategory) ? (value as RequestLogCategory) : undefined;
}

function parseLimit(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
