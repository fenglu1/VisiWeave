import type { Context } from "hono";
import { ProviderError } from "../../infrastructure/providers/image-provider.js";

export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
  };
}

export type ParseResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      error: ErrorResponseBody;
    };

export function errorResponse(code: string, message: string): ErrorResponseBody {
  return {
    error: {
      code,
      message
    }
  };
}

export function downloadFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/gu, "_");
}

export function providerErrorJson(_c: Context, error: ProviderError) {
  const body = errorResponse(error.code, error.message);

  return new Response(JSON.stringify(body), {
    status: providerHttpStatus(error.status),
    headers: {
      "Content-Type": "application/json"
    }
  });
}

function providerHttpStatus(status: number): number {
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502;
}

export function errorToMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Request failed.";
}
