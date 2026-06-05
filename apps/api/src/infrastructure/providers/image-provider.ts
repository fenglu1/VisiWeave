import OpenAI, { APIConnectionTimeoutError, APIError, APIUserAbortError, toFile } from "openai";
import type { Image, ImageEditParamsNonStreaming, ImageGenerateParamsNonStreaming, ImagesResponse } from "openai/resources/images";
import {
  IMAGE_MODEL,
  IMAGE_PROVIDER_FORMATS,
  type ImageProviderFormat,
  type ImageQuality,
  type ImageSize,
  type OutputFormat,
  type ReferenceImageInput
} from "../../domain/contracts.js";

export interface ImageProviderInput {
  originalPrompt: string;
  presetId: string;
  prompt: string;
  size: ImageSize;
  sizeApiValue: string;
  quality: ImageQuality;
  outputFormat: OutputFormat;
  count: number;
}

export interface EditImageProviderInput extends ImageProviderInput {
  referenceImages: ReferenceImageInput[];
  referenceImage?: ReferenceImageInput;
  referenceAssetIds?: string[];
  referenceAssetId?: string;
}

export interface ProviderImage {
  b64Json: string;
}

export interface ProviderResult {
  model: string;
  size: string;
  images: ProviderImage[];
}

export interface ImageProvider {
  generate(input: ImageProviderInput, signal?: AbortSignal): Promise<ProviderResult>;
  edit(input: EditImageProviderInput, signal?: AbortSignal): Promise<ProviderResult>;
}

export type ProviderErrorCode = "missing_api_key" | "missing_provider" | "unsupported_provider_behavior" | "upstream_failure";

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export interface OpenAIImageProviderConfig {
  apiKey: string;
  baseURL?: string;
  imageProviderFormat?: RuntimeImageProviderFormat;
  model: string;
  timeoutMs: number;
}

export const DEFAULT_OPENAI_IMAGE_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_REFERENCE_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_PROVIDER_IMAGE_BYTES = 100 * 1024 * 1024;
const SUPPORTED_REFERENCE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
type RuntimeImageProviderFormat = ImageProviderFormat | "gemini";

type FlexibleImageGenerateParams = Omit<ImageGenerateParamsNonStreaming, "size"> & {
  size: string;
};

type FlexibleImageEditParams = Omit<ImageEditParamsNonStreaming, "size"> & {
  size: string;
};

interface GeminiGenerateContentRequest {
  contents: Array<{
    role: "user";
    parts: GeminiPart[];
  }>;
  generationConfig: {
    responseModalities: ["TEXT", "IMAGE"];
  };
}

type GeminiPart =
  | {
      text: string;
    }
  | {
      inlineData: GeminiInlineData;
    };

interface GeminiInlineData {
  mimeType: string;
  data: string;
}

export function getOpenAIImageProviderConfig():
  | {
      ok: true;
      config: OpenAIImageProviderConfig;
    }
  | {
      ok: false;
      error: ProviderError;
    } {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      error: new ProviderError("missing_api_key", "服务器缺少 OPENAI_API_KEY，无法生成图像。", 500)
    };
  }

  const baseURL = process.env.OPENAI_BASE_URL?.trim();

  return {
    ok: true,
    config: {
      apiKey,
      baseURL: baseURL || undefined,
      imageProviderFormat: parseImageProviderFormat(process.env.OPENAI_IMAGE_PROVIDER_FORMAT) ?? "newapi",
      model: getConfiguredImageModel(),
      timeoutMs: parseOpenAIImageTimeoutMs(process.env.OPENAI_IMAGE_TIMEOUT_MS)
    }
  };
}

export function getConfiguredImageModel(): string {
  return process.env.OPENAI_IMAGE_MODEL?.trim() || IMAGE_MODEL;
}

export function parseOpenAIImageTimeoutMs(value: string | undefined): number {
  return parsePositiveInteger(value, DEFAULT_OPENAI_IMAGE_TIMEOUT_MS);
}

export function createOpenAIImageProvider(config: OpenAIImageProviderConfig): ImageProvider {
  const format = imageProviderFormat(config);
  if (format === "gemini") {
    return new GeminiImageProvider(config);
  }
  return format === "sub2api" ? new Sub2APIImageProvider(config) : new OpenAIImageProvider(config);
}

class OpenAIImageProvider implements ImageProvider {
  private readonly client: OpenAI;

  constructor(private readonly config: OpenAIImageProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: config.timeoutMs
    });
  }

  async generate(input: ImageProviderInput, signal?: AbortSignal): Promise<ProviderResult> {
    try {
      const response = await this.client.images.generate(
        imageGenerateRequestBody({
          model: this.config.model,
          prompt: input.prompt,
          size: input.sizeApiValue,
          quality: input.quality,
          output_format: input.outputFormat,
          n: input.count
        }),
        { signal }
      );

      return await normalizeProviderResponse(response, input.sizeApiValue, this.config.model, signal);
    } catch (error) {
      throw toProviderError(error);
    }
  }

  async edit(input: EditImageProviderInput, signal?: AbortSignal): Promise<ProviderResult> {
    try {
      const references = await Promise.all(input.referenceImages.map((referenceImage) => dataUrlToFile(referenceImage)));
      const response = await this.client.images.edit(
        imageEditRequestBody({
          model: this.config.model,
          image: references,
          prompt: input.prompt,
          size: input.sizeApiValue,
          quality: input.quality,
          output_format: input.outputFormat,
          n: input.count
        }),
        { signal }
      );

      return await normalizeProviderResponse(response, input.sizeApiValue, this.config.model, signal);
    } catch (error) {
      throw toProviderError(error);
    }
  }
}

class Sub2APIImageProvider implements ImageProvider {
  constructor(private readonly config: OpenAIImageProviderConfig) {}

  async generate(input: ImageProviderInput, signal?: AbortSignal): Promise<ProviderResult> {
    return this.postJson(
      "/v1/images/generations",
      {
        model: this.config.model,
        prompt: input.prompt,
        size: input.sizeApiValue,
        quality: input.quality,
        output_format: input.outputFormat,
        response_format: "b64_json",
        stream: true,
        partial_images: 1,
        n: input.count
      },
      input.sizeApiValue,
      signal
    );
  }

  async edit(input: EditImageProviderInput, signal?: AbortSignal): Promise<ProviderResult> {
    const form = new FormData();
    form.set("model", this.config.model);
    form.set("prompt", input.prompt);
    form.set("size", input.sizeApiValue);
    form.set("quality", input.quality);
    form.set("output_format", input.outputFormat);
    form.set("response_format", "b64_json");
    form.set("stream", "true");
    form.set("partial_images", "1");
    form.set("n", String(input.count));

    const references = await Promise.all(input.referenceImages.map((referenceImage) => dataUrlToFile(referenceImage)));
    for (const reference of references) {
      form.append("image", reference);
    }

    return this.postForm("/v1/images/edits", form, input.sizeApiValue, signal);
  }

  private async providerResultFromResponse(
    response: Response,
    sizeApiValue: string,
    signal?: AbortSignal
  ): Promise<ProviderResult> {
    const images = await readSub2APIProviderImages(response, signal);
    if (images.length === 0) {
      throw new ProviderError("unsupported_provider_behavior", "Sub2API 图像服务没有返回图像结果。", 502);
    }

    return {
      model: this.config.model,
      size: sizeApiValue,
      images
    };
  }

  private postJson(path: string, body: Record<string, unknown>, sizeApiValue: string, signal?: AbortSignal): Promise<ProviderResult> {
    return this.post(path, {
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      sizeApiValue,
      signal
    });
  }

  private postForm(path: string, body: FormData, sizeApiValue: string, signal?: AbortSignal): Promise<ProviderResult> {
    return this.post(path, {
      body,
      sizeApiValue,
      signal
    });
  }

  private async post(
    path: string,
    init: {
      body: BodyInit;
      headers?: HeadersInit;
      signal?: AbortSignal;
      sizeApiValue: string;
    }
  ): Promise<ProviderResult> {
    const timeout = timeoutSignal(init.signal, this.config.timeoutMs);
    try {
      const response = await fetch(sub2ApiEndpoint(this.config.baseURL, path), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          Accept: "text/event-stream, application/json",
          ...init.headers
        },
        body: init.body,
        signal: timeout.signal
      }).catch((error: unknown) => {
        throw sub2ApiFetchFailureToProviderError(error);
      });

      if (!response.ok) {
        throw await sub2ApiHttpProviderError(response);
      }

      return await this.providerResultFromResponse(response, init.sizeApiValue, timeout.signal);
    } finally {
      timeout.cleanup();
    }
  }
}

class GeminiImageProvider implements ImageProvider {
  constructor(private readonly config: OpenAIImageProviderConfig) {}

  async generate(input: ImageProviderInput, signal?: AbortSignal): Promise<ProviderResult> {
    return this.post(
      {
        contents: [
          {
            role: "user",
            parts: [{ text: input.prompt }]
          }
        ],
        generationConfig: geminiGenerationConfig()
      },
      input.sizeApiValue,
      signal
    );
  }

  async edit(input: EditImageProviderInput, signal?: AbortSignal): Promise<ProviderResult> {
    return this.post(
      {
        contents: [
          {
            role: "user",
            parts: [...input.referenceImages.map((referenceImage) => ({ inlineData: geminiInlineData(referenceImage) })), { text: input.prompt }]
          }
        ],
        generationConfig: geminiGenerationConfig()
      },
      input.sizeApiValue,
      signal
    );
  }

  private async post(body: GeminiGenerateContentRequest, sizeApiValue: string, signal?: AbortSignal): Promise<ProviderResult> {
    const timeout = timeoutSignal(signal, this.config.timeoutMs);
    try {
      const response = await fetch(geminiGenerateContentEndpoint(this.config.baseURL, this.config.model), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.config.apiKey
        },
        body: JSON.stringify(body),
        signal: timeout.signal
      }).catch((error: unknown) => {
        throw geminiFetchFailureToProviderError(error);
      });

      if (!response.ok) {
        throw await geminiHttpProviderError(response);
      }

      const images = await readGeminiProviderImages(response);
      if (images.length === 0) {
        throw new ProviderError("unsupported_provider_behavior", "Gemini image service did not return image data.", 502);
      }

      return {
        model: this.config.model,
        size: sizeApiValue,
        images
      };
    } finally {
      timeout.cleanup();
    }
  }
}

function imageGenerateRequestBody(body: FlexibleImageGenerateParams): ImageGenerateParamsNonStreaming {
  // The SDK's image size union can lag gpt-image-2's documented flexible-size support.
  return body as unknown as ImageGenerateParamsNonStreaming;
}

function imageEditRequestBody(body: FlexibleImageEditParams): ImageEditParamsNonStreaming {
  // The SDK's image size union can lag gpt-image-2's documented flexible-size support.
  return body as unknown as ImageEditParamsNonStreaming;
}

function geminiGenerationConfig(): GeminiGenerateContentRequest["generationConfig"] {
  return {
    responseModalities: ["TEXT", "IMAGE"]
  };
}

function geminiInlineData(input: ReferenceImageInput): GeminiInlineData {
  const match = /^data:([^;,]+);base64,(.+)$/u.exec(input.dataUrl);
  if (!match) {
    throw new ProviderError("unsupported_provider_behavior", "Reference image data URL is not supported.", 400);
  }

  const mimeType = match[1].toLowerCase();
  if (!SUPPORTED_REFERENCE_MIME_TYPES.has(mimeType)) {
    throw new ProviderError("unsupported_provider_behavior", "Reference images must be PNG, JPEG, or WebP.", 400);
  }

  const data = match[2].trim();
  const bytes = Buffer.from(data, "base64");
  if (bytes.length > MAX_REFERENCE_IMAGE_BYTES) {
    throw new ProviderError("unsupported_provider_behavior", "Reference images cannot exceed 50MB.", 400);
  }

  return {
    mimeType: normalizeReferenceMimeType(mimeType),
    data
  };
}

async function readGeminiProviderImages(response: Response): Promise<ProviderImage[]> {
  let json: unknown;
  try {
    json = (await response.json()) as unknown;
  } catch {
    return [];
  }

  const record = objectValue(json);
  const candidates = Array.isArray(record?.candidates) ? record.candidates : [];
  const images: ProviderImage[] = [];

  for (const candidate of candidates) {
    const candidateRecord = objectValue(candidate);
    const content = objectValue(candidateRecord?.content);
    const parts = Array.isArray(content?.parts) ? content.parts : [];

    for (const part of parts) {
      const partRecord = objectValue(part);
      const inlineData = objectValue(partRecord?.inlineData) ?? objectValue(partRecord?.inline_data);
      const data = stringRecordValue(inlineData, "data");
      if (data) {
        images.push({
          b64Json: normalizeImageBase64(data)
        });
      }
    }
  }

  return images;
}

function toProviderError(error: unknown): Error {
  if (isAbortError(error)) {
    return error;
  }

  if (error instanceof ProviderError) {
    return error;
  }

  if (error instanceof APIConnectionTimeoutError) {
    return new ProviderError("upstream_failure", "OpenAI 图像服务请求超时，请稍后重试或降低分辨率。", 504);
  }

  if (error instanceof APIError) {
    return new ProviderError("upstream_failure", error.message || "OpenAI 图像服务请求失败。", providerHttpStatus(error.status));
  }

  if (error instanceof Error && error.message) {
    return new ProviderError("upstream_failure", error.message, 502);
  }

  return new ProviderError("upstream_failure", "OpenAI 图像服务请求失败。", 502);
}

function providerHttpStatus(status: number | undefined): number {
  return typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isAbortError(error: unknown): error is Error {
  return error instanceof APIUserAbortError || (error instanceof DOMException && error.name === "AbortError");
}

async function normalizeProviderResponse(
  response: ImagesResponse,
  sizeApiValue: string,
  model: string,
  signal?: AbortSignal
): Promise<ProviderResult> {
  if (!Array.isArray(response.data) || response.data.length === 0) {
    throw new ProviderError("unsupported_provider_behavior", "OpenAI 图像服务没有返回图像结果。", 502);
  }

  const images = await Promise.all(response.data.map((item) => providerImageFromResponseItem(item, signal)));

  if (images.some((image) => !image.b64Json)) {
    throw new ProviderError("unsupported_provider_behavior", "OpenAI 图像服务没有返回 base64 图像数据。", 502);
  }

  return {
    model,
    size: sizeApiValue,
    images
  };
}

async function providerImageFromResponseItem(item: Image, signal?: AbortSignal): Promise<ProviderImage> {
  if (typeof item.b64_json === "string" && item.b64_json) {
    return {
      b64Json: item.b64_json
    };
  }

  if (typeof item.url === "string" && item.url) {
    return {
      b64Json: await downloadProviderImageUrl(item.url, signal)
    };
  }

  return {
    b64Json: ""
  };
}

async function readSub2APIProviderImages(response: Response, signal?: AbortSignal): Promise<ProviderImage[]> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = (await response.json()) as ImagesResponse;
    if (!Array.isArray(json.data)) {
      return [];
    }
    const images = await Promise.all(json.data.map((item) => providerImageFromResponseItem(item, signal)));
    return images.filter((image) => image.b64Json);
  }

  return readSub2APIProviderImagesFromStream(response, signal);
}

async function readSub2APIProviderImagesFromStream(response: Response, signal?: AbortSignal): Promise<ProviderImage[]> {
  if (!response.body) {
    const events = parseSseEvents(await response.text());
    return extractSub2APIImagesFromEvents(events, signal);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state: Sub2APISseState = {
    dataLines: [],
    eventName: ""
  };
  let pending = "";
  let isDone = false;

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        isDone = true;
        break;
      }

      pending += decoder.decode(result.value, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";

      for (const rawLine of lines) {
        const images = await processSub2APISseLine(rawLine.replace(/\r$/u, ""), state, signal);
        if (images) {
          return images;
        }
      }
    }

    pending += decoder.decode();
    if (pending) {
      const images = await processSub2APISseLine(pending.replace(/\r$/u, ""), state, signal);
      if (images) {
        return images;
      }
    }

    const finalImages = await flushSub2APISseEvent(state, signal);
    if (finalImages) {
      return finalImages;
    }
    return state.lastCandidate ? [state.lastCandidate] : [];
  } finally {
    if (!isDone) {
      await reader.cancel().catch(() => undefined);
    }
  }
}

function parseSseEvents(text: string): unknown[] {
  const events: unknown[] = [];
  let dataLines: string[] = [];
  let eventName = "";

  const flush = (): void => {
    if (dataLines.length === 0) {
      eventName = "";
      return;
    }

    const data = dataLines.join("\n").trim();
    const currentEventName = eventName;
    eventName = "";
    dataLines = [];
    if (!data || data === "[DONE]") {
      return;
    }

    try {
      events.push(withSub2APIEventName(JSON.parse(data) as unknown, currentEventName));
    } catch {
      events.push(data);
    }
  };

  for (const line of text.split(/\r?\n/u)) {
    if (line.length === 0) {
      flush();
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
      continue;
    }

    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
    }
  }

  flush();
  return events;
}

async function extractSub2APIImagesFromEvents(events: unknown[], signal?: AbortSignal): Promise<ProviderImage[]> {
  let lastCandidate: ProviderImage | undefined;

  for (const event of events) {
    const record = objectValue(event);
    if (!record) {
      continue;
    }

    const errorMessage = sub2ApiEventErrorMessage(record);
    if (errorMessage) {
      throw new ProviderError("upstream_failure", errorMessage, 502);
    }

    const images = await extractSub2APIImagesFromEvent(record, signal);
    if (images.length > 0) {
      lastCandidate = images[images.length - 1];
    }

    if (sub2ApiTerminalEvent(record) && lastCandidate) {
      return [lastCandidate];
    }
  }

  return lastCandidate ? [lastCandidate] : [];
}

async function extractSub2APIImagesFromEvent(record: Record<string, unknown>, signal?: AbortSignal): Promise<ProviderImage[]> {
  const images: ProviderImage[] = [];

  const topLevelImage = await providerImageFromFlexibleRecord(record, signal);
  if (topLevelImage) {
    images.push(topLevelImage);
  }

  const item = objectValue(record.item) ?? objectValue(record.output_item);
  if (item) {
    const itemImage = await providerImageFromFlexibleRecord(item, signal);
    if (itemImage) {
      images.push(itemImage);
    }
  }

  const response = objectValue(record.response);
  const output = Array.isArray(response?.output) ? response.output : [];
  for (const outputItem of output) {
    const outputRecord = objectValue(outputItem);
    if (!outputRecord) {
      continue;
    }

    const outputImage = await providerImageFromFlexibleRecord(outputRecord, signal);
    if (outputImage) {
      images.push(outputImage);
    }
  }

  return images;
}

async function providerImageFromFlexibleRecord(record: Record<string, unknown>, signal?: AbortSignal): Promise<ProviderImage | undefined> {
  const b64Json =
    stringRecordValue(record, "b64_json") ??
    stringRecordValue(record, "partial_image_b64") ??
    stringRecordValue(record, "result");
  if (b64Json) {
    return {
      b64Json: normalizeImageBase64(b64Json)
    };
  }

  const url = stringRecordValue(record, "url");
  if (url) {
    return {
      b64Json: await downloadProviderImageUrl(url, signal)
    };
  }

  return undefined;
}

interface Sub2APISseState {
  dataLines: string[];
  eventName: string;
  lastCandidate?: ProviderImage;
}

async function processSub2APISseLine(
  line: string,
  state: Sub2APISseState,
  signal?: AbortSignal
): Promise<ProviderImage[] | undefined> {
  if (line === "") {
    return flushSub2APISseEvent(state, signal);
  }
  if (line.startsWith(":")) {
    return undefined;
  }
  if (line.startsWith("event:")) {
    state.eventName = line.slice(6).trim();
    return undefined;
  }
  if (line.startsWith("data:")) {
    state.dataLines.push(line.slice(5).trimStart());
  }
  return undefined;
}

async function flushSub2APISseEvent(state: Sub2APISseState, signal?: AbortSignal): Promise<ProviderImage[] | undefined> {
  if (state.dataLines.length === 0) {
    state.eventName = "";
    return undefined;
  }

  const data = state.dataLines.join("\n").trim();
  const eventName = state.eventName;
  state.dataLines = [];
  state.eventName = "";

  if (!data || data === "[DONE]") {
    return undefined;
  }

  let event: unknown;
  try {
    event = withSub2APIEventName(JSON.parse(data) as unknown, eventName);
  } catch {
    return undefined;
  }

  const record = objectValue(event);
  if (!record) {
    return undefined;
  }

  const errorMessage = sub2ApiEventErrorMessage(record);
  if (errorMessage) {
    throw new ProviderError("upstream_failure", errorMessage, 502);
  }

  const images = await extractSub2APIImagesFromEvent(record, signal);
  if (images.length > 0) {
    state.lastCandidate = images[images.length - 1];
  }

  if (sub2ApiTerminalEvent(record) && state.lastCandidate) {
    return [state.lastCandidate];
  }

  return undefined;
}

function withSub2APIEventName(event: unknown, eventName: string): unknown {
  const record = objectValue(event);
  if (!record || !eventName || stringRecordValue(record, "type")) {
    return event;
  }

  return {
    ...record,
    type: eventName
  };
}

function sub2ApiTerminalEvent(record: Record<string, unknown>): boolean {
  const eventType = stringRecordValue(record, "type");
  return eventType === "image_generation.completed" || eventType === "response.completed" || eventType === "response.done";
}

async function downloadProviderImageUrl(url: string, signal?: AbortSignal): Promise<string> {
  const parsedUrl = parseProviderImageUrl(url);
  if (!parsedUrl) {
    throw new ProviderError("unsupported_provider_behavior", "OpenAI 图像服务返回的图片 URL 不受支持。", 502);
  }

  if (parsedUrl.protocol === "data:") {
    return dataUrlToBase64(url);
  }

  const response = await fetch(parsedUrl, { signal });
  if (!response.ok) {
    throw new ProviderError("upstream_failure", "OpenAI 图像 URL 下载失败。", providerHttpStatus(response.status));
  }

  if (!isProviderImageContentType(response.headers.get("content-type"))) {
    throw new ProviderError("unsupported_provider_behavior", "OpenAI 图像 URL 返回的内容不是图片。", 502);
  }

  const contentLength = parseContentLength(response.headers.get("content-length"));
  if (contentLength !== undefined && contentLength > MAX_PROVIDER_IMAGE_BYTES) {
    throw new ProviderError("unsupported_provider_behavior", "OpenAI 图像 URL 返回的文件过大。", 502);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_PROVIDER_IMAGE_BYTES) {
    throw new ProviderError("unsupported_provider_behavior", "OpenAI 图像 URL 返回的文件过大。", 502);
  }
  if (!isProviderImageBytes(bytes)) {
    throw new ProviderError("unsupported_provider_behavior", "OpenAI 图像 URL 返回的内容不是可识别的图片。", 502);
  }

  return bytes.toString("base64");
}

function parseProviderImageUrl(url: string): URL | undefined {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:" || parsedUrl.protocol === "data:"
      ? parsedUrl
      : undefined;
  } catch {
    return undefined;
  }
}

function dataUrlToBase64(url: string): string {
  const match = /^data:image\/[^;,]+;base64,(.+)$/u.exec(url);
  if (!match) {
    throw new ProviderError("unsupported_provider_behavior", "OpenAI 图像服务返回的 data URL 不受支持。", 502);
  }

  return match[1];
}

function normalizeImageBase64(value: string): string {
  const trimmed = value.trim();
  const dataUrlMatch = /^data:image\/[^;,]+;base64,(.+)$/u.exec(trimmed);
  return dataUrlMatch?.[1] ?? trimmed;
}

function normalizeReferenceMimeType(mimeType: string): string {
  return mimeType === "image/jpg" ? "image/jpeg" : mimeType;
}

function imageProviderFormat(config: OpenAIImageProviderConfig): RuntimeImageProviderFormat {
  return parseImageProviderFormat(config.imageProviderFormat) ?? "newapi";
}

function parseImageProviderFormat(value: unknown): RuntimeImageProviderFormat | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return [...IMAGE_PROVIDER_FORMATS, "gemini"].includes(normalized) ? (normalized as RuntimeImageProviderFormat) : undefined;
}

function sub2ApiEndpoint(baseURL: string | undefined, path: string): string {
  const normalizedBaseURL = (baseURL?.trim() || "https://api.openai.com/v1").replace(/\/+$/u, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (normalizedBaseURL.endsWith("/v1") && normalizedPath.startsWith("/v1/")) {
    return `${normalizedBaseURL}${normalizedPath.slice(3)}`;
  }

  return `${normalizedBaseURL}${normalizedPath}`;
}

function geminiGenerateContentEndpoint(baseURL: string | undefined, model: string): string {
  const normalizedBaseURL = (baseURL?.trim() || "https://generativelanguage.googleapis.com").replace(/\/+$/u, "");
  return `${normalizedBaseURL}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

async function sub2ApiHttpProviderError(response: Response): Promise<ProviderError> {
  const message = await safeProviderErrorMessage(response);
  if (response.status === 401 || response.status === 403) {
    return new ProviderError("upstream_failure", message || "Sub2API 图像服务认证失败，请检查 API Key。", response.status);
  }

  if (response.status === 524) {
    return new ProviderError(
      "upstream_failure",
      "Sub2API 图像服务请求超过 Cloudflare 等待窗口，请稍后重试或降低分辨率。",
      providerHttpStatus(response.status)
    );
  }

  return new ProviderError(
    "upstream_failure",
    message || `Sub2API 图像服务请求失败（HTTP ${response.status}）。`,
    providerHttpStatus(response.status)
  );
}

async function geminiHttpProviderError(response: Response): Promise<ProviderError> {
  const message = await safeProviderErrorMessage(response);
  if (response.status === 401 || response.status === 403) {
    return new ProviderError("upstream_failure", message || "Gemini image service authentication failed. Check the API key.", response.status);
  }

  return new ProviderError(
    "upstream_failure",
    message || `Gemini image service request failed (HTTP ${response.status}).`,
    providerHttpStatus(response.status)
  );
}

async function safeProviderErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const json = (await response.json()) as unknown;
      const record = objectValue(json);
      const error = objectValue(record?.error);
      return stringRecordValue(error ?? record, "message") ?? stringRecordValue(record, "detail") ?? "";
    }

    return (await response.text()).trim().slice(0, 300);
  } catch {
    return "";
  }
}

function sub2ApiFetchFailureToProviderError(error: unknown): ProviderError | Error {
  if (isAbortError(error)) {
    return new ProviderError("upstream_failure", "Sub2API 图像服务请求超时，请稍后重试或降低分辨率。", 504);
  }

  if (error instanceof ProviderError) {
    return error;
  }

  return new ProviderError("upstream_failure", "Sub2API 图像服务请求失败，请稍后重试。", 502);
}

function geminiFetchFailureToProviderError(error: unknown): ProviderError | Error {
  if (isAbortError(error)) {
    return new ProviderError("upstream_failure", "Gemini image service request timed out. Try again later or lower the resolution.", 504);
  }

  if (error instanceof ProviderError) {
    return error;
  }

  return new ProviderError("upstream_failure", "Gemini image service request failed. Try again later.", 502);
}

function sub2ApiEventErrorMessage(record: Record<string, unknown>): string {
  const error = record.error;
  if (typeof error === "string") {
    return error;
  }

  const errorRecord = objectValue(error);
  if (errorRecord) {
    return stringRecordValue(errorRecord, "message") ?? stringRecordValue(errorRecord, "code") ?? "";
  }

  const response = objectValue(record.response);
  const status = stringRecordValue(response, "status");
  if (status === "failed" || status === "incomplete" || status === "cancelled" || status === "canceled") {
    const responseError = objectValue(response?.error);
    return stringRecordValue(responseError, "message") ?? `response status: ${status}`;
  }

  return "";
}

function timeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const abort = (): void => controller.abort(signal?.reason);

  if (signal?.aborted) {
    abort();
  } else if (signal) {
    signal.addEventListener("abort", abort, { once: true });
  }

  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  };
}

function isProviderImageContentType(value: string | null): boolean {
  if (!value) {
    return true;
  }

  const contentType = value.split(";")[0]?.trim().toLowerCase();
  return Boolean(contentType?.startsWith("image/") || contentType === "application/octet-stream");
}

function isProviderImageBytes(bytes: Buffer): boolean {
  return isPng(bytes) || isJpeg(bytes) || isWebp(bytes);
}

function isPng(bytes: Buffer): boolean {
  return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function isJpeg(bytes: Buffer): boolean {
  return bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
}

function isWebp(bytes: Buffer): boolean {
  return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

function parseContentLength(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringRecordValue(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function dataUrlToFile(input: ReferenceImageInput): Promise<File> {
  const match = /^data:([^;,]+);base64,(.+)$/u.exec(input.dataUrl);
  if (!match) {
    throw new ProviderError("unsupported_provider_behavior", "参考图像格式不受支持。", 400);
  }

  const mimeType = match[1].toLowerCase();
  if (!SUPPORTED_REFERENCE_MIME_TYPES.has(mimeType)) {
    throw new ProviderError("unsupported_provider_behavior", "参考图像必须是 PNG、JPEG 或 WebP 格式。", 400);
  }

  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > MAX_REFERENCE_IMAGE_BYTES) {
    throw new ProviderError("unsupported_provider_behavior", "参考图像不能超过 50MB。", 400);
  }

  const normalizedMimeType = mimeType === "image/jpg" ? "image/jpeg" : mimeType;
  const extension = normalizedMimeType === "image/jpeg" ? "jpg" : normalizedMimeType.split("/")[1] || "png";
  const fileName = sanitizeFileName(input.fileName) ?? `reference.${extension}`;
  return toFile(bytes, fileName, { type: normalizedMimeType });
}

function sanitizeFileName(fileName: string | undefined): string | undefined {
  const trimmed = fileName?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.replace(/[^a-zA-Z0-9._-]/gu, "_");
}
