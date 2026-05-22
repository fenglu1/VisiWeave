export type KeyframeVideoErrorCode =
  | "video_provider_not_configured"
  | "unsupported_video_mode"
  | "unsupported_provider_behavior"
  | "upstream_failure";

export class KeyframeVideoError extends Error {
  constructor(
    readonly code: KeyframeVideoErrorCode,
    message: string,
    readonly status: number
  ) {
    super(sanitizeKeyframeVideoErrorMessage(message));
  }
}

export function sanitizeKeyframeVideoErrorMessage(message: string): string {
  return message
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "sk-[redacted]")
    .replace(/[A-Za-z]:\\[^\s"'<>]+/gu, "[path redacted]")
    .replace(/([?&](?:api[_-]?key|token|secret|signature)=)[^&\s]+/giu, "$1[redacted]")
    .trim()
    .slice(0, 1200);
}
