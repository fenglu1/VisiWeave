import type { Hono } from "hono";
import { getAuthStatus, logoutCodex, pollCodexDeviceLogin, startCodexDeviceLogin } from "../../domain/providers/codex-auth.js";
import { ProviderError } from "../../infrastructure/providers/image-provider.js";
import { providerErrorJson } from "../http/errors.js";
import { readJson } from "../http/json.js";
import { parseCodexPollPayload } from "../http/validation.js";

export function registerAuthRoutes(app: Hono): void {
  app.get("/api/auth/status", (c) => c.json(getAuthStatus()));

  app.post("/api/auth/codex/device/start", async (c) => {
    try {
      return c.json(await startCodexDeviceLogin(c.req.raw.signal));
    } catch (error) {
      if (error instanceof ProviderError) {
        return providerErrorJson(c, error);
      }

      throw error;
    }
  });

  app.post("/api/auth/codex/device/poll", async (c) => {
    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    const parsed = parseCodexPollPayload(payload.value);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    try {
      return c.json(await pollCodexDeviceLogin(parsed.value, c.req.raw.signal));
    } catch (error) {
      if (error instanceof ProviderError) {
        return providerErrorJson(c, error);
      }

      throw error;
    }
  });

  app.post("/api/auth/codex/logout", (c) => c.json(logoutCodex()));
}
