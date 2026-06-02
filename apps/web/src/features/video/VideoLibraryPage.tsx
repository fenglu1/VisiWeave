import {
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  Film,
  FileVideo,
  Loader2,
  Search,
  Trash2,
  X,
  XCircle
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type VideoBatchDeleteResponse,
  type VideoGenerationStatus,
  type VideoLibraryItem,
  type VideoLibraryResponse
} from "@gpt-image-canvas/shared";
import { assetDownloadUrl } from "../../shared/api/assets";
import { writeClipboardText } from "../../shared/clipboard";
import { localizedApiErrorMessage, useI18n, type Locale, type Translate } from "../../shared/i18n";

const VIDEO_LIBRARY_REFRESH_INTERVAL_MS = 2000;
export const STALE_IN_PROGRESS_DELETE_AFTER_MS = 60 * 60 * 1000;

export interface VideoLibraryPageProps {
  onDeleted?: (outputId: string) => void;
}

type VideoProgressFields = {
  progress?: unknown;
  progressPercent?: unknown;
  progressStage?: unknown;
  percent?: unknown;
  percentage?: unknown;
  phase?: unknown;
  progressMessage?: unknown;
  stage?: unknown;
  stageLabel?: unknown;
  stageMessage?: unknown;
  updatedAt?: unknown;
};

interface VideoProgressDisplay {
  elapsedMs: number;
  percent: number;
  stageText: string;
}

export function VideoLibraryPage({ onDeleted }: VideoLibraryPageProps = {}) {
  const { formatDateTime, locale, t } = useI18n();
  const [items, setItems] = useState<VideoLibraryItem[]>([]);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [copiedOutputId, setCopiedOutputId] = useState<string | null>(null);
  const [deletingOutputId, setDeletingOutputId] = useState<string | null>(null);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [selectedOutputIds, setSelectedOutputIds] = useState<string[]>([]);
  const [selectedItem, setSelectedItem] = useState<VideoLibraryItem | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const selectedItemForRender = selectedItem
    ? items.find((item) => item.outputId === selectedItem.outputId) ?? selectedItem
    : null;
  const statusTimerRef = useRef<number | undefined>();
  const copiedTimerRef = useRef<number | undefined>();

  const loadVideos = useCallback(
    async ({ signal, silent = false }: { signal?: AbortSignal; silent?: boolean } = {}): Promise<void> => {
      if (!silent) {
        setIsLoading(true);
        setError("");
      }

      try {
        const response = await fetch("/api/videos", { signal });
        if (!response.ok) {
          throw new Error(await readVideoLibraryError(response, locale, t));
        }

        const body = (await response.json()) as VideoLibraryResponse;
        if (!Array.isArray(body.items)) {
          throw new Error(t("videoLibraryInvalidData"));
        }

        if (!signal?.aborted) {
          setItems(body.items);
          if (silent) {
            setError("");
          }
        }
      } catch (loadError) {
        if (!signal?.aborted) {
          setError(loadError instanceof Error ? loadError.message : t("videoLibraryLoadFailed"));
        }
      } finally {
        if (!signal?.aborted && !silent) {
          setIsLoading(false);
        }
      }
    },
    [locale, t]
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadVideos({ signal: controller.signal });

    return () => {
      controller.abort();
    };
  }, [loadVideos]);

  useEffect(() => {
    return () => {
      window.clearTimeout(statusTimerRef.current);
      window.clearTimeout(copiedTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!items.some(isActiveVideoItem)) {
      return;
    }

    const timerId = window.setInterval(() => {
      void loadVideos({ silent: true });
      setNowMs(Date.now());
    }, VIDEO_LIBRARY_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(timerId);
    };
  }, [items, loadVideos]);

  useEffect(() => {
    if (!selectedItem) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setSelectedItem(null);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectedItem]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) {
      return items;
    }

    return items.filter((item) => normalizeSearchText(item.prompt).includes(normalizedQuery));
  }, [items, query]);
  const deletableOutputIds = useMemo(() => filteredItems.filter((item) => canDeleteVideoItem(item, nowMs)).map((item) => item.outputId), [filteredItems, nowMs]);
  const selectedDeletableOutputIds = useMemo(
    () => selectedOutputIds.filter((outputId) => deletableOutputIds.includes(outputId)),
    [deletableOutputIds, selectedOutputIds]
  );
  const allDeletableSelected = deletableOutputIds.length > 0 && selectedDeletableOutputIds.length === deletableOutputIds.length;

  useEffect(() => {
    setSelectedOutputIds((current) => current.filter((outputId) => items.some((item) => item.outputId === outputId && canDeleteVideoItem(item, nowMs))));
  }, [items, nowMs]);

  function showStatus(message: string): void {
    window.clearTimeout(statusTimerRef.current);
    setError("");
    setStatusMessage(message);
    statusTimerRef.current = window.setTimeout(() => {
      setStatusMessage("");
    }, 3200);
  }

  async function copyPrompt(item: VideoLibraryItem): Promise<void> {
    const copyKey = videoItemKey(item);
    try {
      await writeClipboardText(item.prompt);
      window.clearTimeout(copiedTimerRef.current);
      setCopiedOutputId(copyKey);
      copiedTimerRef.current = window.setTimeout(() => {
        setCopiedOutputId((current) => (current === copyKey ? null : current));
        copiedTimerRef.current = undefined;
      }, 1800);
      showStatus(t("videoPromptCopied"));
    } catch {
      setError(t("generationCopyFailed"));
    }
  }

  function downloadItem(item: VideoLibraryItem): void {
    if (!item.asset) {
      setError(t("videoAssetMissingDownload"));
      return;
    }

    window.open(assetDownloadUrl(item.asset.id), "_blank", "noopener,noreferrer");
    showStatus(t("videoDownloadOpened"));
  }

  async function deleteItem(item: VideoLibraryItem): Promise<void> {
    if (!canDeleteVideoItem(item, nowMs)) {
      setError(t("videoDeleteRunningDisabled"));
      return;
    }
    if (!window.confirm(t("videoDeleteConfirm", { prompt: promptExcerpt(item.prompt) }))) {
      return;
    }

    setDeletingOutputId(item.outputId);
    setError("");

    try {
      const response = await fetch(`/api/videos/${encodeURIComponent(item.outputId)}`, {
        method: "DELETE"
      });
      if (!response.ok) {
        throw new Error(await readVideoLibraryError(response, locale, t));
      }

      setItems((current) => current.filter((videoItem) => videoItem.outputId !== item.outputId));
      setCopiedOutputId((current) => (current === item.outputId ? null : current));
      setSelectedOutputIds((current) => current.filter((outputId) => outputId !== item.outputId));
      setSelectedItem((current) => (current?.outputId === item.outputId ? null : current));
      onDeleted?.(item.outputId);
      showStatus(t("videoDeleted"));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t("videoDeleteFailed"));
    } finally {
      setDeletingOutputId(null);
    }
  }

  function toggleItemSelection(item: VideoLibraryItem): void {
    if (!canDeleteVideoItem(item, nowMs)) {
      return;
    }

    setSelectedOutputIds((current) =>
      current.includes(item.outputId) ? current.filter((outputId) => outputId !== item.outputId) : [...current, item.outputId]
    );
  }

  function selectAllDeletable(): void {
    setSelectedOutputIds(deletableOutputIds);
  }

  function clearSelection(): void {
    setSelectedOutputIds([]);
  }

  async function deleteSelectedItems(): Promise<void> {
    if (selectedDeletableOutputIds.length === 0) {
      return;
    }
    if (!window.confirm(t("videoBatchDeleteConfirm", { count: selectedDeletableOutputIds.length }))) {
      return;
    }

    setBatchDeleting(true);
    setError("");

    try {
      const response = await fetch("/api/videos/batch-delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ outputIds: selectedDeletableOutputIds })
      });
      if (!response.ok) {
        throw new Error(await readVideoLibraryError(response, locale, t));
      }

      const body = (await response.json()) as VideoBatchDeleteResponse;
      if (!isVideoBatchDeleteResponse(body)) {
        throw new Error(t("videoBatchDeleteFailed"));
      }

      const deletedIds = new Set(body.deletedIds);
      setItems((current) => current.filter((item) => !deletedIds.has(item.outputId)));
      setCopiedOutputId((current) => (current && deletedIds.has(current) ? null : current));
      setSelectedItem((current) => (current && deletedIds.has(current.outputId) ? null : current));
      setSelectedOutputIds((current) => current.filter((outputId) => !deletedIds.has(outputId)));
      for (const outputId of deletedIds) {
        onDeleted?.(outputId);
      }
      showStatus(t("videoBatchDeleted", { count: deletedIds.size }));
      if (body.failedIds.length > 0 || body.skippedIds.length > 0) {
        setError(t("videoBatchDeletePartial", { count: body.failedIds.length + body.skippedIds.length }));
      }
      void loadVideos({ silent: true });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t("videoBatchDeleteFailed"));
    } finally {
      setBatchDeleting(false);
    }
  }

  return (
    <main className="video-page app-view" data-testid="video-library-page">
      <div className="video-shell">
        <header className="video-library-header">
          <div>
            <p className="video-kicker">
              <Film className="size-4" aria-hidden="true" />
              {t("videoLibraryKicker")}
            </p>
            <h1>{t("videoLibraryTitle")}</h1>
            <p>{t("videoLibraryDeck")}</p>
          </div>
          <div className="video-library-count" aria-label={t("videoLibraryCountAria", { count: items.length })}>
            <strong>{items.length}</strong>
            <span>{t("videoLibraryCountLabel")}</span>
          </div>
          <div className="video-search" role="search">
            <Search className="size-4" aria-hidden="true" />
            <input
              aria-label={t("videoSearchAria")}
              placeholder={t("videoSearchPlaceholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </header>

        {error ? (
          <div className="video-alert video-alert--error" data-testid="video-library-error" role="alert">
            <XCircle className="size-4" aria-hidden="true" />
            <p>{error}</p>
          </div>
        ) : null}
        {statusMessage ? (
          <div className="video-alert video-alert--success" data-testid="video-library-status" role="status">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            <p>{statusMessage}</p>
          </div>
        ) : null}
        {!isLoading && filteredItems.length > 0 ? (
          <section className="video-bulk-toolbar" aria-label={t("videoBatchToolbarAria")}>
            <div>
              <strong>{t("videoBatchSelectedCount", { count: selectedDeletableOutputIds.length })}</strong>
              <span>{t("videoBatchDeletableCount", { count: deletableOutputIds.length })}</span>
            </div>
            <div className="video-bulk-toolbar__actions">
              <button className="video-inline-button" disabled={deletableOutputIds.length === 0 || allDeletableSelected} type="button" onClick={selectAllDeletable}>
                {t("videoBatchSelectAll")}
              </button>
              <button className="video-inline-button" disabled={selectedDeletableOutputIds.length === 0 || batchDeleting} type="button" onClick={clearSelection}>
                {t("videoBatchClearSelection")}
              </button>
              <button
                className="video-inline-button video-inline-button--danger"
                disabled={selectedDeletableOutputIds.length === 0 || batchDeleting}
                type="button"
                onClick={() => void deleteSelectedItems()}
              >
                {batchDeleting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
                {t("videoBatchDeleteSelected")}
              </button>
            </div>
          </section>
        ) : null}

        {isLoading ? (
          <div className="video-empty-state" role="status">
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            <p>{t("videoLibraryLoading")}</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="video-empty-state" data-testid="video-library-empty">
            <Film className="size-7" aria-hidden="true" />
            <div>
              <p>{items.length === 0 ? t("videoLibraryEmpty") : t("videoLibraryNoMatches")}</p>
              <span>{items.length === 0 ? t("videoLibraryEmptyHint") : t("videoLibraryNoMatchesHint")}</span>
            </div>
          </div>
        ) : (
          <section className="video-card-grid" aria-label={t("videoLibraryResultsAria")}>
            {filteredItems.map((item) => (
              <article
                aria-label={t("videoOpenDetailsAction", { prompt: promptExcerpt(item.prompt) })}
                className="video-card"
                data-active={isActiveVideoItem(item)}
                data-selected={selectedOutputIds.includes(item.outputId)}
                data-testid="video-library-card"
                key={videoItemKey(item)}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedItem(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedItem(item);
                  }
                }}
              >
                <label
                  className="video-card__select"
                  onClick={(event) => event.stopPropagation()}
                >
                  <input
                    aria-label={t("videoSelectForDelete", { prompt: promptExcerpt(item.prompt) })}
                    checked={selectedOutputIds.includes(item.outputId)}
                    disabled={!canDeleteVideoItem(item, nowMs) || batchDeleting}
                    type="checkbox"
                    onChange={() => toggleItemSelection(item)}
                  />
                  <span>{t("videoSelectForDeleteLabel")}</span>
                </label>
                <div className="video-card__media">
                  <VideoAssetPreview item={item} nowMs={nowMs} />
                </div>
                <div className="video-card__body">
                  <div className="video-tags">
                    <span>{t("videoModeValue", { mode: item.mode })}</span>
                    <span>{t("videoDurationOption", { seconds: item.durationSeconds })}</span>
                    <span>{item.aspectRatio}</span>
                    <span>{t("videoStatusValue", { status: item.status })}</span>
                  </div>
                  <p className="video-card__prompt">{item.prompt}</p>
                  {isActiveVideoItem(item) ? <VideoProgressInline item={item} nowMs={nowMs} /> : null}
                  {item.error ? <p className="video-card__error">{item.error}</p> : null}
                  <div className="video-card__footer">
                    <span className="video-time-tag">
                      <Clock3 className="size-3.5" aria-hidden="true" />
                      {formatDateTime(item.createdAt)}
                    </span>
                    <div className="video-card__actions">
                      <button
                        aria-label={t("videoCopyPromptAction", { prompt: promptExcerpt(item.prompt) })}
                        className="video-icon-action"
                        data-copied={copiedOutputId === videoItemKey(item)}
                        title={t("commonCopy")}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void copyPrompt(item);
                        }}
                      >
                        {copiedOutputId === videoItemKey(item) ? (
                          <CheckCircle2 className="size-4" aria-hidden="true" />
                        ) : (
                          <Copy className="size-4" aria-hidden="true" />
                        )}
                      </button>
                      <button
                        aria-label={t("videoOpenDetailsAction", { prompt: promptExcerpt(item.prompt) })}
                        className="video-icon-action"
                        title={t("videoDetailsAction")}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedItem(item);
                        }}
                      >
                        <FileVideo className="size-4" aria-hidden="true" />
                      </button>
                      {item.asset ? (
                        <button
                          aria-label={t("videoDownloadAction", { prompt: promptExcerpt(item.prompt) })}
                          className="video-icon-action"
                          title={t("commonDownload")}
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            downloadItem(item);
                          }}
                        >
                          <Download className="size-4" aria-hidden="true" />
                        </button>
                      ) : null}
                      {item.outputId ? (
                        <button
                          aria-label={t("videoDeleteAction", { prompt: promptExcerpt(item.prompt) })}
                          className="video-icon-action video-icon-action--danger"
                          disabled={deletingOutputId === item.outputId || !canDeleteVideoItem(item, nowMs)}
                          title={canDeleteVideoItem(item, nowMs) ? t("commonRemove") : t("videoDeleteRunningDisabled")}
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void deleteItem(item);
                          }}
                        >
                          {deletingOutputId === item.outputId ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Trash2 className="size-4" aria-hidden="true" />
                          )}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
      {selectedItemForRender ? (
        <VideoDetailModal
          deletingOutputId={deletingOutputId}
          item={selectedItemForRender}
          nowMs={nowMs}
          onClose={() => setSelectedItem(null)}
          onDelete={(item) => void deleteItem(item)}
          onDownload={downloadItem}
        />
      ) : null}
    </main>
  );
}

function VideoAssetPreview({ item, nowMs }: { item: VideoLibraryItem; nowMs: number }) {
  const { t } = useI18n();
  const asset = item.asset;

  if (!asset) {
    if (isActiveVideoItem(item)) {
      return (
        <div className="video-card__processing-preview">
          <Loader2 className="size-6 animate-spin" aria-hidden="true" />
          <VideoProgressInline item={item} nowMs={nowMs} compact />
        </div>
      );
    }

    return (
      <div className="video-card__missing-preview">
        <XCircle className="size-6" aria-hidden="true" />
        <p>{item.error || t("videoAssetMissing")}</p>
      </div>
    );
  }

  if (asset.mimeType.startsWith("video/")) {
    return (
      <video controls preload="metadata" src={asset.url} onClick={(event) => event.stopPropagation()}>
        <a href={assetDownloadUrl(asset.id)}>{t("commonDownload")}</a>
      </video>
    );
  }

  return (
    <figure className="video-card__placeholder-preview">
      <img alt={item.prompt} loading="lazy" src={asset.url} />
      <figcaption>{t("videoNonPlayableAsset")}</figcaption>
    </figure>
  );
}

function VideoDetailModal({
  deletingOutputId,
  item,
  nowMs,
  onClose,
  onDelete,
  onDownload
}: {
  deletingOutputId: string | null;
  item: VideoLibraryItem;
  nowMs: number;
  onClose: () => void;
  onDelete: (item: VideoLibraryItem) => void;
  onDownload: (item: VideoLibraryItem) => void;
}) {
  const { formatDateTime, t } = useI18n();
  const asset = item.asset;
  const isPlayableVideo = Boolean(asset?.mimeType.startsWith("video/"));

  return (
    <div className="video-modal" role="presentation" onClick={onClose}>
      <section
        aria-labelledby="video-detail-title"
        aria-modal="true"
        className="video-modal__dialog"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="video-modal__header">
          <div>
            <p className="video-kicker">{t("videoDetailsKicker")}</p>
            <h2 id="video-detail-title">{t("videoDetailsTitle")}</h2>
          </div>
          <button className="video-icon-action" type="button" aria-label={t("commonClose")} onClick={onClose}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="video-modal__media">
          {isPlayableVideo && asset ? (
            <video controls preload="metadata" src={asset.url}>
              <a href={assetDownloadUrl(asset.id)}>{t("commonDownload")}</a>
            </video>
          ) : asset ? (
            <div className="video-modal__non-video">
              <img alt="" src={asset.url} />
              <p>{t("videoNonPlayableAssetDetail")}</p>
            </div>
          ) : isActiveVideoItem(item) ? (
            <div className="video-modal__non-video">
              <Loader2 className="size-8 animate-spin" aria-hidden="true" />
              <VideoProgressInline item={item} nowMs={nowMs} />
            </div>
          ) : (
            <div className="video-modal__non-video">
              <XCircle className="size-8" aria-hidden="true" />
              <p>{item.error || t("videoAssetMissing")}</p>
            </div>
          )}
        </div>

        <div className="video-modal__content">
          <section>
            <h3>{t("videoPromptLabel")}</h3>
            <p>{item.prompt}</p>
          </section>
          <section>
            <h3>{t("videoEffectivePromptLabel")}</h3>
            <p>{item.effectivePrompt || item.prompt}</p>
          </section>

          <dl className="video-detail-list">
            <DetailRow label={t("videoModeLabel")} value={t("videoModeValue", { mode: item.mode })} />
            <DetailRow label={t("videoDurationLabel")} value={t("videoDurationOption", { seconds: item.durationSeconds })} />
            <DetailRow label={t("videoAspectRatioLabel")} value={item.aspectRatio} />
            <DetailRow label={t("videoProviderLabel")} value={item.provider} />
            <DetailRow label={t("videoCreatedAtLabel")} value={formatDateTime(item.createdAt)} />
            <DetailRow label={t("videoStatusLabel")} value={t("videoStatusValue", { status: item.status })} />
            {item.error ? <DetailRow label={t("videoErrorLabel")} value={item.error} /> : null}
            <DetailRow label={t("videoAssetMimeLabel")} value={asset?.mimeType ?? t("videoAssetMissingValue")} />
            <DetailRow label={t("videoAssetFileLabel")} value={asset?.fileName ?? t("videoAssetMissingValue")} />
          </dl>
        </div>

        <footer className="video-modal__footer">
          {asset ? (
            <button className="video-inline-button" type="button" onClick={() => onDownload(item)}>
              <Download className="size-4" aria-hidden="true" />
              {t("commonDownload")}
            </button>
          ) : null}
          {item.outputId ? (
            <button
              className="video-inline-button video-inline-button--danger"
              disabled={deletingOutputId === item.outputId || !canDeleteVideoItem(item, nowMs)}
              title={canDeleteVideoItem(item, nowMs) ? undefined : t("videoDeleteRunningDisabled")}
              type="button"
              onClick={() => onDelete(item)}
            >
              {deletingOutputId === item.outputId ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="size-4" aria-hidden="true" />
              )}
              {t("commonRemove")}
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}

function VideoProgressInline({
  compact = false,
  item,
  nowMs
}: {
  compact?: boolean;
  item: VideoLibraryItem;
  nowMs: number;
}) {
  const { t } = useI18n();
  const progress = progressDisplayForItem(item, nowMs, t);

  return (
    <section className="video-progress-inline" data-compact={compact} aria-label={t("videoProgressInlineAria")}>
      <div className="video-progress-inline__header">
        <span>{progress.stageText}</span>
        <strong>{t("videoProgressPercent", { percent: progress.percent })}</strong>
      </div>
      <div
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={progress.percent}
        className="video-progress-bar"
        role="progressbar"
      >
        <span style={{ width: `${progress.percent}%` }} />
      </div>
      <p>
        <Clock3 className="size-3.5" aria-hidden="true" />
        {t("videoProgressElapsed", { time: formatElapsedDuration(progress.elapsedMs, t) })}
      </p>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function normalizeSearchText(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}

function promptExcerpt(value: string): string {
  const compact = value.replace(/\s+/gu, " ").trim();
  return compact.length > 48 ? `${compact.slice(0, 48)}...` : compact;
}

function videoItemKey(item: VideoLibraryItem): string {
  return item.outputId || `${item.generationId}:${item.createdAt}`;
}

function isActiveVideoItem(item: VideoLibraryItem): boolean {
  return item.status === "queued" || item.status === "running";
}

export function canDeleteVideoItem(item: VideoLibraryItem, nowMs = Date.now()): boolean {
  return Boolean(item.outputId) && (!isActiveVideoItem(item) || isStaleInProgressVideoItem(item.createdAt, nowMs));
}

export function isStaleInProgressVideoItem(createdAt: string, nowMs = Date.now()): boolean {
  const createdMs = timestampMs(createdAt);
  return nowMs - createdMs >= STALE_IN_PROGRESS_DELETE_AFTER_MS;
}

function progressDisplayForItem(item: VideoLibraryItem, nowMs: number, t: Translate): VideoProgressDisplay {
  const progressFields = item as VideoLibraryItem & VideoProgressFields;
  return {
    elapsedMs: Math.max(0, nowMs - timestampMs(item.createdAt)),
    percent: progressPercentForStatus(item.status, readProgressPercent(progressFields)),
    stageText: readStageText(progressFields, item.status, t)
  };
}

function readProgressPercent(value: VideoProgressFields): number | undefined {
  const candidates = [value.progressPercent, value.percent, value.percentage, value.progress];
  for (const candidate of candidates) {
    const numericValue = typeof candidate === "number" ? candidate : typeof candidate === "string" ? Number(candidate) : Number.NaN;
    if (Number.isFinite(numericValue)) {
      return numericValue <= 1 && numericValue > 0 ? numericValue * 100 : numericValue;
    }
  }

  return undefined;
}

function readStageText(value: VideoProgressFields, status: VideoGenerationStatus, t: Translate): string {
  const stage = [value.stageMessage, value.progressMessage, value.stageLabel, value.progressStage, value.phase, value.stage].find(
    (candidate) => typeof candidate === "string" && candidate.trim().length > 0
  );

  return typeof stage === "string" ? stage.trim() : fallbackStageText(status, t);
}

function fallbackStageText(status: VideoGenerationStatus, t: Translate): string {
  switch (status) {
    case "queued":
      return t("videoProgressStageQueued");
    case "running":
      return t("videoProgressStageRunning");
    case "succeeded":
      return t("videoProgressStageSucceeded");
    case "failed":
      return t("videoProgressStageFailed");
    case "cancelled":
      return t("videoProgressStageCancelled");
  }
}

function progressPercentForStatus(status: VideoGenerationStatus, progressPercent: number | undefined): number {
  if (status === "succeeded") {
    return 100;
  }
  if (status === "failed" || status === "cancelled") {
    return clampProgressPercent(progressPercent ?? 100);
  }
  if (typeof progressPercent === "number") {
    return clampProgressPercent(progressPercent);
  }

  return status === "queued" ? 8 : 35;
}

function clampProgressPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function timestampMs(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function formatElapsedDuration(elapsedMs: number, t: Translate): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) {
    return t("videoProgressElapsedSeconds", { seconds });
  }

  return t("videoProgressElapsedMinutes", { minutes, seconds });
}

function isVideoBatchDeleteResponse(value: unknown): value is VideoBatchDeleteResponse {
  if (!isRecord(value)) {
    return false;
  }

  return (
    Array.isArray(value.deletedIds) &&
    Array.isArray(value.notFoundIds) &&
    Array.isArray(value.skippedIds) &&
    Array.isArray(value.failedIds)
  );
}

async function readVideoLibraryError(response: Response, locale: Locale, t: Translate): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    return localizedApiErrorMessage({
      code: body.error?.code,
      fallbackMessage: body.error?.message,
      fallbackText: t("videoLibraryRequestFailed", { status: response.status }),
      locale,
      status: response.status
    });
  } catch {
    return t("videoLibraryRequestFailed", { status: response.status });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
