const DEFAULT_LOG_PREVIEW_LIMIT = 1200;

export function formatLogValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value ?? null, null, 2);
}

export function previewLogValue(value: unknown, maxLength = DEFAULT_LOG_PREVIEW_LIMIT): string {
  const fullValue = formatLogValue(value);
  if (fullValue.length <= maxLength) {
    return fullValue;
  }

  return `${fullValue.slice(0, maxLength).trimEnd()}\n...[TRUNCATED ${fullValue.length - maxLength} chars]`;
}

export function copyableLogValue(value: unknown): string {
  return formatLogValue(value);
}
