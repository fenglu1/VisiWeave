import type { Hono } from "hono";
import { preferredImageProviderModel, type ImageProviderModelsResponse } from "../../domain/contracts.js";
import { getLocalOpenAIImageProviderConfigForKind, getProviderConfig, saveProviderConfig } from "../../domain/providers/provider-config.js";
import { listGeminiImageModels, ProviderError } from "../../infrastructure/providers/image-provider.js";
import { errorResponse, errorToMessage, providerErrorJson } from "../http/errors.js";
import { readJson } from "../http/json.js";
import { parseImageProviderModelsPayload, parseProviderConfigPayload } from "../http/validation.js";

export function registerProviderConfigRoutes(app: Hono): void {
  app.get("/api/provider-config", (c) => c.json(getProviderConfig()));

  app.post("/api/provider-config/image-models", async (c) => {
    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    const parsed = parseImageProviderModelsPayload(payload.value);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    if (parsed.value.kind !== "gemini") {
      return c.json(errorResponse("invalid_provider_config", "Image model listing is only available for Gemini."), 400);
    }

    const savedConfig = getLocalOpenAIImageProviderConfigForKind("gemini");
    const apiKey = parsed.value.apiKey?.trim() || (parsed.value.preserveApiKey ? savedConfig?.apiKey : undefined);
    if (!apiKey) {
      return c.json(errorResponse("missing_api_key", "Gemini image model listing requires an API key."), 400);
    }

    try {
      const models = await listGeminiImageModels(
        {
          apiKey,
          baseURL: parsed.value.baseUrl?.trim() || savedConfig?.baseURL,
          timeoutMs: parsed.value.timeoutMs ?? savedConfig?.timeoutMs ?? 60000
        },
        c.req.raw.signal
      );
      const body: ImageProviderModelsResponse = {
        kind: "gemini",
        models,
        defaultModel: preferredImageProviderModel(models)
      };
      return c.json(body);
    } catch (error) {
      if (error instanceof ProviderError) {
        return providerErrorJson(c, error);
      }

      throw error;
    }
  });

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
