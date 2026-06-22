import { randomUUID } from "node:crypto";
import { and, desc, eq, lt } from "drizzle-orm";
import type {
  RequestLogCategory,
  RequestLogDetailResponse,
  RequestLogEntry,
  RequestLogListResponse,
  RequestLogService
} from "../contracts.js";
import { isAgentRequestLoggingEnabled } from "../agent/config.js";
import { isImageRequestLoggingEnabled, isVideoRequestLoggingEnabled } from "../providers/provider-config.js";
import { db } from "../../infrastructure/database.js";
import { providerRequestLogs } from "../../infrastructure/schema.js";

export const REQUEST_LOG_RETENTION_HOURS = 6;
const REQUEST_LOG_RETENTION_MS = REQUEST_LOG_RETENTION_HOURS * 60 * 60 * 1000;
const MAX_LOGGED_STRING_LENGTH = 8000;
const MAX_RESPONSE_PREVIEW_LENGTH = 12000;
const SENSITIVE_KEY_PATTERN = /(?:api[_-]?key|authorization|bearer|token|secret|password|credential|session|cookie)/iu;
const DATA_URL_PATTERN = /^data:([^;,]+);base64,/iu;
const BASE64_LIKE_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/u;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/gu;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/giu;
const SK_KEY_PATTERN = /\b(?:sk|ek)_[A-Za-z0-9_-]{6,}\b|\bsk-[A-Za-z0-9_-]{6,}\b/gu;

export interface ProviderRequestLogContext {
  category: RequestLogCategory;
  providerKind: string;
  relatedGenerationId?: string;
  relatedOutputId?: string;
  service: RequestLogService;
}

interface RecordProviderRequestLogInput extends ProviderRequestLogContext {
  durationMs?: number;
  error?: string;
  method: string;
  requestBody: unknown;
  requestHeaders?: unknown;
  responseBodyPreview?: unknown;
  responseStatus?: number;
  url: string;
}

export interface LoggedFetchInit extends RequestInit {
  requestLog?: ProviderRequestLogContext;
}

export async function loggedProviderFetch(url: string, init: LoggedFetchInit): Promise<Response> {
  const { requestLog, ...fetchInit } = init;
  if (!requestLog || !isRequestLoggingEnabled(requestLog.service)) {
    return fetch(url, fetchInit);
  }

  const startedAt = Date.now();
  try {
    const response = await fetch(url, fetchInit);
    await recordProviderRequestLog({
      ...requestLog,
      method: fetchInit.method ?? "GET",
      requestBody: bodyForLog(fetchInit.body),
      requestHeaders: headersForLog(fetchInit.headers),
      responseBodyPreview: await responsePreviewForLog(response),
      responseStatus: response.status,
      durationMs: Date.now() - startedAt,
      url
    });
    return response;
  } catch (error) {
    await recordProviderRequestLog({
      ...requestLog,
      method: fetchInit.method ?? "GET",
      requestBody: bodyForLog(fetchInit.body),
      requestHeaders: headersForLog(fetchInit.headers),
      error: errorMessage(error),
      durationMs: Date.now() - startedAt,
      url
    });
    throw error;
  }
}

export async function recordProviderRequestLog(input: RecordProviderRequestLogInput): Promise<void> {
  if (!isRequestLoggingEnabled(input.service)) {
    return;
  }

  try {
    cleanupExpiredRequestLogs();
    const createdAt = new Date().toISOString();
    db.insert(providerRequestLogs)
      .values({
        id: randomUUID(),
        service: input.service,
        category: input.category,
        providerKind: input.providerKind,
        method: input.method.toUpperCase(),
        url: input.url,
        path: pathForLog(input.url),
        requestHeadersJson: serializeForLog(input.requestHeaders ?? {}),
        requestBodyJson: serializeForLog(input.requestBody ?? null),
        responseStatus: input.responseStatus ?? null,
        responseBodyPreviewJson: input.responseBodyPreview === undefined ? null : serializeForLog(input.responseBodyPreview),
        error: input.error ? redactString(input.error) : null,
        durationMs: input.durationMs ?? null,
        relatedGenerationId: input.relatedGenerationId ?? null,
        relatedOutputId: input.relatedOutputId ?? null,
        createdAt
      })
      .run();
  } catch (error) {
    console.warn(`Provider request logging failed: ${errorMessage(error)}`);
  }
}

export function listProviderRequestLogs(filters: {
  category?: RequestLogCategory;
  limit?: number;
  service?: RequestLogService;
} = {}): RequestLogListResponse {
  cleanupExpiredRequestLogs();
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 300);
  const conditions = [
    filters.service ? eq(providerRequestLogs.service, filters.service) : undefined,
    filters.category ? eq(providerRequestLogs.category, filters.category) : undefined
  ].filter(isDefined);
  const rows = conditions.length > 0
    ? db.select().from(providerRequestLogs).where(and(...conditions)).orderBy(desc(providerRequestLogs.createdAt)).limit(limit).all()
    : db.select().from(providerRequestLogs).orderBy(desc(providerRequestLogs.createdAt)).limit(limit).all();

  return {
    items: rows.map(toRequestLogEntry),
    retentionHours: REQUEST_LOG_RETENTION_HOURS
  };
}

export function getProviderRequestLog(id: string): RequestLogDetailResponse | undefined {
  cleanupExpiredRequestLogs();
  const row = db.select().from(providerRequestLogs).where(eq(providerRequestLogs.id, id)).get();
  return row
    ? {
        item: toRequestLogEntry(row),
        retentionHours: REQUEST_LOG_RETENTION_HOURS
      }
    : undefined;
}

export function deleteProviderRequestLogs(): void {
  db.delete(providerRequestLogs).run();
}

export function cleanupExpiredRequestLogs(now = new Date()): void {
  const cutoff = new Date(now.getTime() - REQUEST_LOG_RETENTION_MS).toISOString();
  db.delete(providerRequestLogs).where(lt(providerRequestLogs.createdAt, cutoff)).run();
}

export function sanitizeForRequestLog(value: unknown): unknown {
  return sanitizeValue(value);
}

function isRequestLoggingEnabled(service: RequestLogService): boolean {
  if (service === "image") {
    return isImageRequestLoggingEnabled();
  }
  if (service === "video") {
    return isVideoRequestLoggingEnabled();
  }
  return isAgentRequestLoggingEnabled();
}

function toRequestLogEntry(row: typeof providerRequestLogs.$inferSelect): RequestLogEntry {
  return {
    id: row.id,
    service: row.service as RequestLogService,
    category: row.category as RequestLogCategory,
    providerKind: row.providerKind,
    method: row.method,
    url: row.url,
    path: row.path,
    requestHeaders: parseJson(row.requestHeadersJson),
    requestBody: parseJson(row.requestBodyJson),
    responseStatus: row.responseStatus ?? undefined,
    responseBodyPreview: row.responseBodyPreviewJson ? parseJson(row.responseBodyPreviewJson) : undefined,
    error: row.error ?? undefined,
    durationMs: row.durationMs ?? undefined,
    relatedGenerationId: row.relatedGenerationId ?? undefined,
    relatedOutputId: row.relatedOutputId ?? undefined,
    createdAt: row.createdAt
  };
}

function serializeForLog(value: unknown): string {
  return JSON.stringify(sanitizeValue(value));
}

function sanitizeValue(value: unknown, keyPath: string[] = []): unknown {
  const currentKey = keyPath[keyPath.length - 1] ?? "";
  if (SENSITIVE_KEY_PATTERN.test(currentKey)) {
    return "[REDACTED]";
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) {
    return value ?? null;
  }

  if (value instanceof File) {
    return `[FILE name=${value.name || "unnamed"} type=${value.type || "unknown"} size=${value.size}]`;
  }

  if (value instanceof Blob) {
    return `[BLOB type=${value.type || "unknown"} size=${value.size}]`;
  }

  if (ArrayBuffer.isView(value)) {
    return `[BINARY bytes=${value.byteLength}]`;
  }

  if (value instanceof ArrayBuffer) {
    return `[BINARY bytes=${value.byteLength}]`;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeValue(item, [...keyPath, String(index)]));
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = sanitizeValue(item, [...keyPath, key]);
    }
    return result;
  }

  return String(value);
}

function redactString(value: string): string {
  const trimmed = value.trim();
  const dataUrlMatch = DATA_URL_PATTERN.exec(trimmed);
  if (dataUrlMatch) {
    return `[DATA_URL mime=${dataUrlMatch[1]} bytes~=base64:${trimmed.length}]`;
  }
  if (trimmed.length > 256 && BASE64_LIKE_PATTERN.test(trimmed)) {
    return `[BASE64 bytes~=base64:${trimmed.length}]`;
  }

  const redacted = value
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(SK_KEY_PATTERN, "[REDACTED_KEY]")
    .replace(JWT_PATTERN, "[REDACTED_JWT]");

  if (redacted.length <= MAX_LOGGED_STRING_LENGTH) {
    return redacted;
  }

  return `${redacted.slice(0, MAX_LOGGED_STRING_LENGTH)}...[TRUNCATED ${redacted.length - MAX_LOGGED_STRING_LENGTH} chars]`;
}

function headersForLog(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [key, value]));
  }
  return {
    ...headers
  };
}

function bodyForLog(body: BodyInit | null | undefined): unknown {
  if (!body) {
    return null;
  }

  if (typeof body === "string") {
    return parseJson(body) ?? body;
  }

  if (body instanceof FormData) {
    const result: Record<string, unknown> = {};
    body.forEach((value, key) => {
      const nextValue = sanitizeValue(value, [key]);
      if (Object.hasOwn(result, key)) {
        result[key] = Array.isArray(result[key]) ? [...(result[key] as unknown[]), nextValue] : [result[key], nextValue];
      } else {
        result[key] = nextValue;
      }
    });
    return result;
  }

  if (body instanceof URLSearchParams) {
    return Object.fromEntries(body.entries());
  }

  if (body instanceof Blob) {
    return `[BLOB type=${body.type || "unknown"} size=${body.size}]`;
  }

  if (body instanceof ArrayBuffer) {
    return `[BINARY bytes=${body.byteLength}]`;
  }

  if (ArrayBuffer.isView(body)) {
    return `[BINARY bytes=${body.byteLength}]`;
  }

  return "[STREAM_BODY]";
}

async function responsePreviewForLog(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!isTextLikeContentType(contentType)) {
    return `[RESPONSE content-type=${contentType || "unknown"} status=${response.status}]`;
  }

  try {
    const text = await response.clone().text();
    const preview = text.length > MAX_RESPONSE_PREVIEW_LENGTH
      ? `${text.slice(0, MAX_RESPONSE_PREVIEW_LENGTH)}...[TRUNCATED ${text.length - MAX_RESPONSE_PREVIEW_LENGTH} chars]`
      : text;
    return contentType.toLowerCase().includes("json") ? (parseJson(preview) ?? preview) : preview;
  } catch (error) {
    return `[UNREADABLE_RESPONSE ${errorMessage(error)}]`;
  }
}

function isTextLikeContentType(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return (
    normalized.includes("application/json") ||
    normalized.startsWith("text/") ||
    normalized.includes("event-stream") ||
    normalized.includes("application/x-ndjson")
  );
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function pathForLog(value: string): string {
  try {
    const url = new URL(value);
    return decodeURIComponent(`${url.pathname || "/"}${url.search}`);
  } catch {
    return value;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
