import type { Hono } from "hono";
import { getProviderConfig, saveProviderConfig } from "../../domain/providers/provider-config.js";
import { errorResponse, errorToMessage } from "../http/errors.js";
import { readJson } from "../http/json.js";
import { parseProviderConfigPayload } from "../http/validation.js";

export function registerProviderConfigRoutes(app: Hono): void {
  app.get("/api/provider-config", (c) => c.json(getProviderConfig()));

  app.put("/api/provider-config", async (c) => {
    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    const parsed = parseProviderConfigPayload(payload.value);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    try {
      return c.json(saveProviderConfig(parsed.value));
    } catch (error) {
      return c.json(errorResponse("provider_config_error", errorToMessage(error)), 400);
    }
  });
}
