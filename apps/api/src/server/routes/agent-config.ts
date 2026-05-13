import type { Hono } from "hono";
import { getAgentLlmConfig, saveAgentLlmConfig } from "../../domain/agent/config.js";
import { errorResponse, errorToMessage } from "../http/errors.js";
import { readJson } from "../http/json.js";
import { parseAgentLlmConfigPayload } from "../http/validation.js";

export function registerAgentConfigRoutes(app: Hono): void {
  app.get("/api/agent-config", (c) => c.json(getAgentLlmConfig()));

  app.put("/api/agent-config", async (c) => {
    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    const parsed = parseAgentLlmConfigPayload(payload.value);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    try {
      return c.json(saveAgentLlmConfig(parsed.value));
    } catch (error) {
      return c.json(errorResponse("agent_config_error", errorToMessage(error)), 400);
    }
  });
}
