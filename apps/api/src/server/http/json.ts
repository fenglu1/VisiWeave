import { errorResponse, type ParseResult } from "./errors.js";

export async function readJson(request: Request): Promise<ParseResult<unknown>> {
  const contentType = request.headers.get("content-type");
  if (contentType && !isJsonContentType(contentType)) {
    return {
      ok: false,
      error: errorResponse("unsupported_media_type", "请求 Content-Type 必须是 application/json。")
    };
  }

  let bodyText: string;
  try {
    bodyText = await request.text();
  } catch {
    return {
      ok: false,
      error: errorResponse("invalid_request_body", "请求体读取失败，请重试。")
    };
  }

  if (bodyText.trim().length === 0) {
    return {
      ok: false,
      error: errorResponse("empty_json", "请求体不能为空，必须是有效的 JSON。")
    };
  }

  try {
    return {
      ok: true,
      value: JSON.parse(bodyText) as unknown
    };
  } catch {
    return {
      ok: false,
      error: errorResponse("invalid_json", "请求体必须是有效的 JSON。")
    };
  }
}

function isJsonContentType(contentType: string): boolean {
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json" || Boolean(mediaType?.endsWith("+json"));
}
