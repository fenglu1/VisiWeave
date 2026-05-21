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
import { useEffect, useMemo, useRef, useState } from "react";
import { type VideoLibraryItem, type VideoLibraryResponse } from "@gpt-image-canvas/shared";
import { assetDownloadUrl } from "../../shared/api/assets";
import { localizedApiErrorMessage, useI18n, type Locale, type Translate } from "../../shared/i18n";

export interface VideoLibraryPageProps {
  onDeleted?: (outputId: string) => void;
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
  const [selectedItem, setSelectedItem] = useState<VideoLibraryItem | null>(null);
  const statusTimerRef = useRef<number | undefined>();
  const copiedTimerRef = useRef<number | undefined>();

  useEffect(() => {
    const controller = new AbortController();

    async function loadVideos(): Promise<void> {
      setIsLoading(true);
      setError("");

      try {
        const response = await fetch("/api/videos", { signal: controller.signal });
        if (!response.ok) {
          throw new Error(await readVideoLibraryError(response, locale, t));
        }

        const body = (await response.json()) as VideoLibraryResponse;
        if (!Array.isArray(body.items)) {
          throw new Error(t("videoLibraryInvalidData"));
        }

        if (!controller.signal.aborted) {
          setItems(body.items);
        }
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : t("videoLibraryLoadFailed"));
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadVideos();

    return () => {
      controller.abort();
    };
  }, [locale, t]);

  useEffect(() => {
    return () => {
      window.clearTimeout(statusTimerRef.current);
      window.clearTimeout(copiedTimerRef.current);
    };
  }, []);

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
    if (!item.outputId) {
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
      setSelectedItem((current) => (current?.outputId === item.outputId ? null : current));
      onDeleted?.(item.outputId);
      showStatus(t("videoDeleted"));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t("videoDeleteFailed"));
    } finally {
      setDeletingOutputId(null);
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
                <div className="video-card__media">
                  <VideoAssetPreview item={item} />
                </div>
                <div className="video-card__body">
                  <div className="video-tags">
                    <span>{t("videoModeValue", { mode: item.mode })}</span>
                    <span>{t("videoDurationOption", { seconds: item.durationSeconds })}</span>
                    <span>{item.aspectRatio}</span>
                    <span>{t("videoStatusValue", { status: item.status })}</span>
                  </div>
                  <p className="video-card__prompt">{item.prompt}</p>
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
                          disabled={deletingOutputId === item.outputId}
                          title={t("commonRemove")}
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
      {selectedItem ? (
        <VideoDetailModal
          deletingOutputId={deletingOutputId}
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onDelete={(item) => void deleteItem(item)}
          onDownload={downloadItem}
        />
      ) : null}
    </main>
  );
}

function VideoAssetPreview({ item }: { item: VideoLibraryItem }) {
  const { t } = useI18n();
  const asset = item.asset;

  if (!asset) {
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
  onClose,
  onDelete,
  onDownload
}: {
  deletingOutputId: string | null;
  item: VideoLibraryItem;
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
              disabled={deletingOutputId === item.outputId}
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

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.readOnly = true;
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.top = "0";
  document.body.append(textArea);
  textArea.select();

  try {
    const copied = document.execCommand("copy");
    if (!copied) {
      throw new Error("Copy command was not accepted.");
    }
  } finally {
    textArea.remove();
  }
}
