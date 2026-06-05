import {
  adapterConfigured,
  buildImageProviderSavePayloadForActiveKind,
  type ImageAdapterConfigView,
  type ImageProviderFormMap
} from "../features/provider-config/ProviderConfigDialog";

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
    apiKey: "typed-gemini-key",
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
expect(payload?.imageConfigs?.gemini?.apiKey === "typed-gemini-key", "global save includes the edited Gemini key");
expect(enablePayload?.localOpenAI?.imageProviderFormat === "gemini", "adapter enable payload switches the active adapter");

expect(adapterConfigured(savedConfigs.gemini, forms.gemini) === true, "typed key makes an unsaved adapter available immediately");

console.log("provider config dialog smoke checks passed");

function expect(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}
