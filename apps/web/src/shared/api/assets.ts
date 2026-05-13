export function assetPreviewUrl(assetId: string, width: number): string {
  return `/api/assets/${encodeURIComponent(assetId)}/preview?width=${width}`;
}

export function assetDownloadUrl(assetId: string): string {
  return `/api/assets/${encodeURIComponent(assetId)}/download`;
}
