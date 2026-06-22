export const REQUEST_LOG_SERVICES = ["image", "video", "agent"] as const;
export type RequestLogService = (typeof REQUEST_LOG_SERVICES)[number];

export const REQUEST_LOG_CATEGORIES = ["text_to_image", "image_to_image", "text_to_video", "image_to_video", "agent"] as const;
export type RequestLogCategory = (typeof REQUEST_LOG_CATEGORIES)[number];

export interface RequestLogEntry {
  id: string;
  service: RequestLogService;
  category: RequestLogCategory;
  providerKind: string;
  method: string;
  url: string;
  path: string;
  requestHeaders: unknown;
  requestBody: unknown;
  responseStatus?: number;
  responseBodyPreview?: unknown;
  error?: string;
  durationMs?: number;
  relatedGenerationId?: string;
  relatedOutputId?: string;
  createdAt: string;
}

export interface RequestLogListResponse {
  items: RequestLogEntry[];
  retentionHours: number;
}

export interface RequestLogDetailResponse {
  item: RequestLogEntry;
  retentionHours: number;
}
