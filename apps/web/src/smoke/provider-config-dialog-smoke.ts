import {
  adapterConfigured,
  buildImageProviderSavePayloadForActiveKind,
  cacheGeminiModelOptions,
  cachedGeminiModelOptions,
  imageFormsWithGeminiModelSelection,
  imageModelSelectOptions,
  type ImageAdapterConfigView,
  type ImageProviderFormMap
} from "../features/provider-config/ProviderConfigDialog";
import { preferredImageProviderModel } from "@gpt-image-canvas/shared";

const forms: ImageProviderFormMap = {
  newapi: {
    apiKey: "",
    baseUrl: "https://newapi.example.test/v1",
    model: "gpt-image-1",
    timeoutMs: "1200000"
  },
  sub2api: {
    apiKey: "",
    baseUrl: "https://sub2api.example.test/v1",
    model: "sub2api-image",
    timeoutMs: "1200000"
  },
  gemini: {
    apiKey: "fake-gemini-key",
    baseUrl: "https://generativelanguage.googleapis.com",
    model: "gemini-2.5-flash-image",
    timeoutMs: "1200000"
  }
};

const savedConfigs: Partial<Record<keyof ImageProviderFormMap, ImageAdapterConfigView>> = {
  newapi: {
    kind: "newapi",
    apiKey: {
      hasSecret: true,
      value: "sk-...new"
    },
    baseUrl: "https://newapi.example.test/v1",
    imageProviderFormat: "newapi",
    model: "gpt-image-1",
    timeoutMs: 1200000,
    configured: true,
    source: "local"
  },
  gemini: {
    kind: "gemini",
    apiKey: {
      hasSecret: false
    },
    baseUrl: "https://generativelanguage.googleapis.com",
    imageProviderFormat: "gemini",
    model: "gemini-2.5-flash-image",
    timeoutMs: 1200000,
    configured: false,
    source: "local"
  }
};

const payload = buildImageProviderSavePayloadForActiveKind("newapi", forms, savedConfigs);
const enablePayload = buildImageProviderSavePayloadForActiveKind("gemini", forms, savedConfigs);

expect(payload !== null, "valid image adapter forms produce a save payload");
expect(payload?.localOpenAI?.imageProviderFormat === "newapi", "global save keeps the saved active adapter");
expect(payload?.localOpenAI?.preserveApiKey === true, "global save preserves the saved active adapter key");
expect(payload?.imageConfigs?.gemini?.imageProviderFormat === "gemini", "global save still persists the edited Gemini row");
expect(payload?.imageConfigs?.gemini?.apiKey === "fake-gemini-key", "global save includes the edited Gemini key");
expect(enablePayload?.localOpenAI?.imageProviderFormat === "gemini", "adapter enable payload switches the active adapter");

expect(adapterConfigured(savedConfigs.gemini, forms.gemini) === true, "typed key makes an unsaved adapter available immediately");
expect(
  preferredImageProviderModel([
    { id: "seedream/seedream-5-0", displayName: "Seedream 5" },
    { id: "openai/gpt-image-2", displayName: "GPT Image 2" },
    { id: "vertex/nano-banana-2", displayName: "Nano Banana 2" }
  ]) === "openai/gpt-image-2",
  "Gemini model default prefers openai/gpt-image-2"
);
expect(
  preferredImageProviderModel([
    { id: "seedream/seedream-5-0", displayName: "Seedream 5" },
    { id: "vertex/nano-banana-2", displayName: "Nano Banana 2" }
  ]) === "seedream/seedream-5-0",
  "Gemini model default falls back to seedream/seedream-5-0"
);
expect(
  preferredImageProviderModel([{ id: "vertex/anon-bob", displayName: "Anon Bob" }]) === "vertex/anon-bob",
  "Gemini model default falls back to the first relay model"
);
const geminiModelForms = imageFormsWithGeminiModelSelection(forms, {
  defaultModel: "openai/gpt-image-2",
  models: [
    { id: "seedream/seedream-5-0", displayName: "Seedream 5" },
    { id: "openai/gpt-image-2", displayName: "GPT Image 2" }
  ]
});
expect(geminiModelForms.gemini.model === "openai/gpt-image-2", "Gemini enable flow selects the model-list default");
expect(geminiModelForms.newapi.model === forms.newapi.model, "Gemini enable flow leaves NewAPI form unchanged");
const geminiModelPayload = buildImageProviderSavePayloadForActiveKind("gemini", geminiModelForms, savedConfigs);
expect(geminiModelPayload?.localOpenAI?.model === "openai/gpt-image-2", "Gemini enable payload saves the selected relay model");

const cacheStorage = new Map<string, string>();
const browserStorage = {
  getItem: (key: string) => cacheStorage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    cacheStorage.set(key, value);
  }
};
cacheGeminiModelOptions(browserStorage, forms.gemini.baseUrl, [
  { id: " openai/gpt-image-2 ", displayName: " GPT Image 2 " },
  { id: "seedream/seedream-5-0", displayName: "Seedream 5" },
  { id: "", displayName: "ignored" },
  { id: "openai/gpt-image-2", displayName: "Duplicate" }
]);
const cachedModels = cachedGeminiModelOptions(browserStorage, forms.gemini.baseUrl);
expect(cachedModels.length === 2, "Gemini model cache keeps a clean deduped relay model list");
expect(cachedModels[0]?.id === "openai/gpt-image-2", "Gemini model cache trims model ids");
expect(cachedModels[0]?.displayName === "GPT Image 2", "Gemini model cache trims display names");
const cachedSelectOptions = imageModelSelectOptions(cachedModels, "custom/current-model");
expect(cachedSelectOptions[0]?.id === "custom/current-model", "Gemini model dropdown keeps the current saved model selectable");
expect(cachedSelectOptions.length === 3, "Gemini model dropdown includes cached models after the current saved model");

console.log("provider config dialog smoke checks passed");

function expect(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}
