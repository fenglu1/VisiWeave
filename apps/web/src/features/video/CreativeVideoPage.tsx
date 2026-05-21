import {
  ArrowRight,
  CheckCircle2,
  Film,
  ImageIcon,
  Loader2,
  PlaySquare,
  Sparkles,
  X,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_VIDEO_DURATION_SECONDS,
  VIDEO_ASPECT_RATIOS,
  VIDEO_DURATION_PRESETS,
  type GalleryImageItem,
  type GalleryResponse,
  type GenerateVideoRequest,
  type VideoDurationPreset,
  type VideoGenerationJobResponse,
  type VideoGenerationStatus,
  type VideoProviderStatus,
  type VideoProviderStatusResponse
} from "@gpt-image-canvas/shared";
import { assetPreviewUrl } from "../../shared/api/assets";
import { localizedApiErrorMessage, useI18n, type Locale, type Translate } from "../../shared/i18n";

const VIDEO_JOB_POLL_INTERVAL_MS = 1600;
const VIDEO_JOB_POLL_TIMEOUT_MS = 10 * 60 * 1000;

export interface CreativeVideoPageProps {
  initialReferenceAssetId?: string;
  initialPrompt?: string;
  onOpenVideoLibrary: () => void;
  onClearInitialReference?: () => void;
}

type VideoMode = "text_to_video" | "image_to_video";

export function CreativeVideoPage({
  initialReferenceAssetId,
  initialPrompt,
  onClearInitialReference,
  onOpenVideoLibrary
}: CreativeVideoPageProps) {
  const { locale, t } = useI18n();
  const [mode, setMode] = useState<VideoMode>(initialReferenceAssetId ? "image_to_video" : "text_to_video");
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [durationSeconds, setDurationSeconds] = useState<VideoDurationPreset>(DEFAULT_VIDEO_DURATION_SECONDS);
  const [aspectRatio, setAspectRatio] = useState<(typeof VIDEO_ASPECT_RATIOS)[number]>(VIDEO_ASPECT_RATIOS[0]);
  const [galleryItems, setGalleryItems] = useState<GalleryImageItem[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryError, setGalleryError] = useState("");
  const [selectedReferenceAssetId, setSelectedReferenceAssetId] = useState(initialReferenceAssetId ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [providerStatus, setProviderStatus] = useState<VideoProviderStatus | null>(null);
  const [providerLoading, setProviderLoading] = useState(true);
  const [providerError, setProviderError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function loadProviderStatus(): Promise<void> {
      setProviderLoading(true);
      setProviderError("");

      try {
        const response = await fetch("/api/videos/provider-status", { signal: controller.signal });
        if (!response.ok) {
          throw new Error(await readVideoApiError(response, locale, t, t("videoProviderStatusRequestFailed", { status: response.status })));
        }

        const body = (await response.json()) as unknown;
        if (!isVideoProviderStatusResponse(body)) {
          throw new Error(t("videoProviderStatusInvalidData"));
        }

        if (!controller.signal.aborted) {
          setProviderStatus(body.provider);
        }
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setProviderError(loadError instanceof Error ? loadError.message : t("videoProviderStatusLoadFailed"));
          setProviderStatus(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setProviderLoading(false);
        }
      }
    }

    void loadProviderStatus();

    return () => {
      controller.abort();
    };
  }, [locale, t]);

  useEffect(() => {
    if (initialPrompt) {
      setPrompt(initialPrompt);
    }
  }, [initialPrompt]);

  useEffect(() => {
    if (!initialReferenceAssetId) {
      return;
    }
    setMode("image_to_video");
    setSelectedReferenceAssetId(initialReferenceAssetId);
  }, [initialReferenceAssetId]);

  useEffect(() => {
    if (mode !== "image_to_video") {
      return;
    }

    const controller = new AbortController();

    async function loadGalleryReferences(): Promise<void> {
      setGalleryLoading(true);
      setGalleryError("");

      try {
        const response = await fetch("/api/gallery", { signal: controller.signal });
        if (!response.ok) {
          throw new Error(await readVideoApiError(response, locale, t, t("videoGalleryRequestFailed", { status: response.status })));
        }

        const body = (await response.json()) as GalleryResponse;
        if (!Array.isArray(body.items)) {
          throw new Error(t("videoGalleryInvalidData"));
        }

        if (!controller.signal.aborted) {
          setGalleryItems(body.items);
        }
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setGalleryError(loadError instanceof Error ? loadError.message : t("videoGalleryLoadFailed"));
        }
      } finally {
        if (!controller.signal.aborted) {
          setGalleryLoading(false);
        }
      }
    }

    void loadGalleryReferences();

    return () => {
      controller.abort();
    };
  }, [locale, mode, t]);

  const selectedReference = useMemo(
    () => galleryItems.find((item) => item.asset.id === selectedReferenceAssetId) ?? null,
    [galleryItems, selectedReferenceAssetId]
  );
  const hasExternalReference = Boolean(initialReferenceAssetId && selectedReferenceAssetId === initialReferenceAssetId && !selectedReference);
  const modeSupported = isModeSupported(providerStatus, mode);
  const providerReady = Boolean(providerStatus?.configured && modeSupported);
  const providerBlockMessage = providerLoading
    ? t("videoProviderChecking")
    : providerError || providerUnavailableMessage(providerStatus, mode, t);
  const canSubmit =
    prompt.trim().length > 0 &&
    !submitting &&
    providerReady &&
    (mode === "text_to_video" || selectedReferenceAssetId.trim().length > 0);

  async function submitVideo(): Promise<void> {
    if (!providerReady) {
      setError(providerBlockMessage || t("videoProviderNotConfigured"));
      return;
    }
    if (!prompt.trim()) {
      setError(t("videoPromptRequired"));
      return;
    }
    if (mode === "image_to_video" && !selectedReferenceAssetId.trim()) {
      setError(t("videoReferenceRequired"));
      return;
    }

    setSubmitting(true);
    setError("");
    setStatusMessage("");

    const request: GenerateVideoRequest = {
      mode,
      prompt: prompt.trim(),
      durationSeconds,
      aspectRatio,
      ...(mode === "image_to_video" ? { referenceAssetId: selectedReferenceAssetId } : {})
    };

    try {
      const response = await fetch("/api/videos/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(request)
      });
      if (!response.ok) {
        throw new Error(await readVideoApiError(response, locale, t, t("videoGenerateRequestFailed", { status: response.status })));
      }

      const body = (await response.json()) as VideoGenerationJobResponse;
      if (!isVideoGenerationJobResponse(body)) {
        throw new Error(t("videoGenerateInvalidData"));
      }

      if (body.job.status === "failed") {
        throw new Error(body.job.error?.trim() || t("videoGenerateFailed"));
      }

      if (body.job.status === "succeeded") {
        setStatusMessage(t("videoGenerateSaved"));
      } else {
        setStatusMessage(t("videoGenerateSubmitted"));
        const completedJob = await pollVideoJob(body.job.id, locale, t);
        if (completedJob.job.status === "failed") {
          throw new Error(completedJob.job.error?.trim() || t("videoGenerateFailed"));
        }
        if (completedJob.job.status === "cancelled") {
          throw new Error(t("videoGenerateCancelled"));
        }
        setStatusMessage(t("videoGenerateSaved"));
      }

      onClearInitialReference?.();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("videoGenerateFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  function clearReference(): void {
    setSelectedReferenceAssetId("");
    onClearInitialReference?.();
  }

  return (
    <main className="video-page app-view" data-testid="creative-video-page">
      <div className="video-shell">
        <header className="video-hero" aria-labelledby="creative-video-title">
          <div className="video-hero__copy">
            <p className="video-kicker">
              <Sparkles className="size-4" aria-hidden="true" />
              {t("videoCreativeKicker")}
            </p>
            <h1 id="creative-video-title">{t("videoCreativeTitle")}</h1>
            <p>{t("videoCreativeDeck")}</p>
          </div>
          <button className="video-library-link" type="button" onClick={onOpenVideoLibrary}>
            <Film className="size-4" aria-hidden="true" />
            {t("videoOpenLibrary")}
            <ArrowRight className="size-4" aria-hidden="true" />
          </button>
        </header>

        <section className="video-workbench" aria-label={t("videoWorkspaceAria")}>
          <form
            className="video-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submitVideo();
            }}
          >
            <div className="video-mode-toggle" role="radiogroup" aria-label={t("videoModeLabel")}>
              <button
                aria-checked={mode === "text_to_video"}
                className="video-mode-card"
                data-selected={mode === "text_to_video"}
                role="radio"
                type="button"
                onClick={() => setMode("text_to_video")}
              >
                <PlaySquare className="size-5" aria-hidden="true" />
                <span>
                  <b>{t("videoModeText")}</b>
                  {t("videoModeTextHint")}
                </span>
              </button>
              <button
                aria-checked={mode === "image_to_video"}
                className="video-mode-card"
                data-selected={mode === "image_to_video"}
                role="radio"
                type="button"
                onClick={() => setMode("image_to_video")}
              >
                <ImageIcon className="size-5" aria-hidden="true" />
                <span>
                  <b>{t("videoModeImage")}</b>
                  {t("videoModeImageHint")}
                </span>
              </button>
            </div>

            <section className="video-provider-panel" aria-label={t("videoProviderStatusAria")}>
              <div className="video-provider-panel__header">
                <span className="video-provider-panel__title">{t("videoProviderStatusTitle")}</span>
                <span className="video-provider-badge" data-state={providerStatus?.configured ? "ready" : "missing"}>
                  {providerLoading ? t("videoProviderChecking") : providerStatus?.configured ? t("videoProviderConfigured") : t("videoProviderMissing")}
                </span>
              </div>
              <div className="video-provider-capabilities" aria-label={t("videoProviderCapabilitiesAria")}>
                <span data-supported={Boolean(providerStatus?.supportsTextToVideo)}>
                  {t("videoProviderTextToVideoCapability", { state: capabilityState(providerStatus?.supportsTextToVideo, t) })}
                </span>
                <span data-supported={Boolean(providerStatus?.supportsImageToVideo)}>
                  {t("videoProviderImageToVideoCapability", { state: capabilityState(providerStatus?.supportsImageToVideo, t) })}
                </span>
              </div>
              {providerStatus?.message ? <p>{providerStatus.message}</p> : null}
              {providerBlockMessage ? <p className="video-provider-panel__warning">{providerBlockMessage}</p> : null}
            </section>

            <label className="video-field">
              <span>{t("videoPromptLabel")}</span>
              <textarea
                className="video-textarea"
                name="video-prompt"
                placeholder={mode === "image_to_video" ? t("videoPromptImagePlaceholder") : t("videoPromptTextPlaceholder")}
                rows={7}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </label>

            <div className="video-setting-grid">
              <fieldset className="video-choice-group">
                <legend>{t("videoDurationLabel")}</legend>
                <div className="video-segmented">
                  {VIDEO_DURATION_PRESETS.map((duration) => (
                    <button
                      aria-pressed={durationSeconds === duration}
                      className="video-pill-button"
                      data-selected={durationSeconds === duration}
                      key={duration}
                      type="button"
                      onClick={() => setDurationSeconds(duration)}
                    >
                      {t("videoDurationOption", { seconds: duration })}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="video-choice-group">
                <legend>{t("videoAspectRatioLabel")}</legend>
                <div className="video-segmented">
                  {VIDEO_ASPECT_RATIOS.map((ratio) => (
                    <button
                      aria-pressed={aspectRatio === ratio}
                      className="video-pill-button"
                      data-selected={aspectRatio === ratio}
                      key={ratio}
                      type="button"
                      onClick={() => setAspectRatio(ratio)}
                    >
                      {ratio}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>

            {mode === "image_to_video" ? (
              <section className="video-reference-panel" aria-labelledby="video-reference-title">
                <div className="video-section-heading">
                  <h2 id="video-reference-title">{t("videoReferenceTitle")}</h2>
                  {selectedReferenceAssetId ? (
                    <button className="video-inline-button" type="button" onClick={clearReference}>
                      <X className="size-4" aria-hidden="true" />
                      {t("videoClearReference")}
                    </button>
                  ) : null}
                </div>

                {galleryError ? (
                  <div className="video-alert video-alert--error" role="alert">
                    <XCircle className="size-4" aria-hidden="true" />
                    <p>{galleryError}</p>
                  </div>
                ) : null}

                {galleryLoading ? (
                  <div className="video-reference-state" role="status">
                    <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                    {t("videoGalleryLoading")}
                  </div>
                ) : galleryItems.length === 0 && !hasExternalReference ? (
                  <div className="video-reference-state">
                    <ImageIcon className="size-5" aria-hidden="true" />
                    <span>{t("videoGalleryEmpty")}</span>
                  </div>
                ) : (
                  <div className="video-reference-grid">
                    {hasExternalReference ? (
                      <ReferenceTile
                        checked
                        label={t("videoInitialReferenceLabel", { assetId: selectedReferenceAssetId })}
                        prompt={initialPrompt ?? t("videoExternalReferencePrompt")}
                        src={assetPreviewUrl(selectedReferenceAssetId, 384)}
                        onSelect={() => setSelectedReferenceAssetId(selectedReferenceAssetId)}
                      />
                    ) : null}
                    {galleryItems.map((item) => (
                      <ReferenceTile
                        checked={selectedReferenceAssetId === item.asset.id}
                        key={item.outputId}
                        label={item.prompt}
                        prompt={item.prompt}
                        src={assetPreviewUrl(item.asset.id, 384)}
                        onSelect={() => setSelectedReferenceAssetId(item.asset.id)}
                      />
                    ))}
                  </div>
                )}

                {selectedReference ? (
                  <p className="video-reference-note">{t("videoSelectedReference", { prompt: promptExcerpt(selectedReference.prompt) })}</p>
                ) : hasExternalReference ? (
                  <p className="video-reference-note">{t("videoSelectedExternalReference")}</p>
                ) : null}
              </section>
            ) : null}

            {error ? (
              <div className="video-alert video-alert--error" data-testid="creative-video-error" role="alert">
                <XCircle className="size-4" aria-hidden="true" />
                <p>{error}</p>
              </div>
            ) : null}
            {statusMessage ? (
              <div className="video-alert video-alert--success" data-testid="creative-video-status" role="status">
                <CheckCircle2 className="size-4" aria-hidden="true" />
                <p>{statusMessage}</p>
              </div>
            ) : null}

            <footer className="video-form__footer">
              <p>{providerBlockMessage || (mode === "image_to_video" ? t("videoSubmitImageHint") : t("videoSubmitTextHint"))}</p>
              <button className="video-primary-action" disabled={!canSubmit} type="submit">
                {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
                {submitting ? t("videoWaitingForJob") : t("videoGenerateAction")}
              </button>
            </footer>
          </form>

          <aside className="video-brief-panel" aria-label={t("videoBriefAria")}>
            <span className="video-brief-panel__mark">10s</span>
            <h2>{t("videoBriefTitle")}</h2>
            <p>{t("videoBriefCopy")}</p>
            <dl>
              <div>
                <dt>{t("videoModeLabel")}</dt>
                <dd>{mode === "image_to_video" ? t("videoModeImage") : t("videoModeText")}</dd>
              </div>
              <div>
                <dt>{t("videoDurationLabel")}</dt>
                <dd>{t("videoDurationOption", { seconds: durationSeconds })}</dd>
              </div>
              <div>
                <dt>{t("videoAspectRatioLabel")}</dt>
                <dd>{aspectRatio}</dd>
              </div>
            </dl>
          </aside>
        </section>
      </div>
    </main>
  );
}

function ReferenceTile({
  checked,
  label,
  prompt,
  src,
  onSelect
}: {
  checked: boolean;
  label: string;
  prompt: string;
  src: string;
  onSelect: () => void;
}) {
  const { t } = useI18n();

  return (
    <button
      aria-label={t("videoSelectReference", { prompt: promptExcerpt(label) })}
      className="video-reference-tile"
      data-selected={checked}
      type="button"
      onClick={onSelect}
    >
      <img alt="" loading="lazy" src={src} />
      <span className="video-reference-tile__check" aria-hidden="true">
        <CheckCircle2 className="size-4" />
      </span>
      <span>{promptExcerpt(prompt)}</span>
    </button>
  );
}

function isVideoGenerationJobResponse(value: unknown): value is VideoGenerationJobResponse {
  if (!isRecord(value) || !isRecord(value.job)) {
    return false;
  }

  const { job } = value;
  return (
    typeof job.id === "string" &&
    isVideoMode(job.mode) &&
    typeof job.prompt === "string" &&
    typeof job.effectivePrompt === "string" &&
    typeof job.durationSeconds === "number" &&
    VIDEO_ASPECT_RATIOS.includes(job.aspectRatio as (typeof VIDEO_ASPECT_RATIOS)[number]) &&
    isRecord(job.size) &&
    typeof job.size.width === "number" &&
    typeof job.size.height === "number" &&
    typeof job.provider === "string" &&
    isVideoStatus(job.status) &&
    (job.error === undefined || typeof job.error === "string") &&
    (job.referenceAssetId === undefined || typeof job.referenceAssetId === "string") &&
    typeof job.createdAt === "string" &&
    typeof job.updatedAt === "string" &&
    Array.isArray(job.outputs) &&
    job.outputs.every(isVideoGenerationOutput)
  );
}

function isVideoGenerationOutput(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    isVideoStatus(value.status) &&
    (value.asset === undefined || isVideoAsset(value.asset)) &&
    (value.error === undefined || typeof value.error === "string") &&
    typeof value.createdAt === "string"
  );
}

function isVideoAsset(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.url === "string" &&
    typeof value.fileName === "string" &&
    typeof value.mimeType === "string" &&
    typeof value.width === "number" &&
    typeof value.height === "number" &&
    typeof value.durationSeconds === "number"
  );
}

function isVideoProviderStatusResponse(value: unknown): value is VideoProviderStatusResponse {
  if (!isRecord(value) || !isRecord(value.provider)) {
    return false;
  }

  const { provider } = value;
  return (
    typeof provider.id === "string" &&
    typeof provider.configured === "boolean" &&
    typeof provider.supportsTextToVideo === "boolean" &&
    typeof provider.supportsImageToVideo === "boolean" &&
    (provider.message === undefined || typeof provider.message === "string")
  );
}

function isVideoMode(value: unknown): value is VideoMode {
  return value === "text_to_video" || value === "image_to_video";
}

function isVideoStatus(value: unknown): value is VideoGenerationStatus {
  return value === "queued" || value === "running" || value === "succeeded" || value === "failed" || value === "cancelled";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isModeSupported(provider: VideoProviderStatus | null, mode: VideoMode): boolean {
  if (!provider) {
    return false;
  }

  return mode === "image_to_video" ? provider.supportsImageToVideo : provider.supportsTextToVideo;
}

function providerUnavailableMessage(provider: VideoProviderStatus | null, mode: VideoMode, t: Translate): string {
  if (!provider?.configured) {
    return t("videoProviderNotConfigured");
  }

  if (!isModeSupported(provider, mode)) {
    return mode === "image_to_video" ? t("videoProviderImageModeUnsupported") : t("videoProviderTextModeUnsupported");
  }

  return "";
}

function capabilityState(supported: boolean | undefined, t: Translate): string {
  return supported ? t("videoProviderSupported") : t("videoProviderUnsupported");
}

async function pollVideoJob(jobId: string, locale: Locale, t: Translate): Promise<VideoGenerationJobResponse> {
  const deadline = Date.now() + VIDEO_JOB_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await delay(VIDEO_JOB_POLL_INTERVAL_MS);

    const response = await fetch(`/api/videos/${encodeURIComponent(jobId)}`);
    if (!response.ok) {
      throw new Error(await readVideoApiError(response, locale, t, t("videoJobStatusRequestFailed", { status: response.status })));
    }

    const body = (await response.json()) as unknown;
    if (!isVideoGenerationJobResponse(body)) {
      throw new Error(t("videoGenerateInvalidData"));
    }

    if (body.job.status === "succeeded" || body.job.status === "failed" || body.job.status === "cancelled") {
      return body;
    }
  }

  throw new Error(t("videoGenerateTimedOut"));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function promptExcerpt(value: string): string {
  const compact = value.replace(/\s+/gu, " ").trim();
  return compact.length > 64 ? `${compact.slice(0, 64)}...` : compact;
}

async function readVideoApiError(response: Response, locale: Locale, t: Translate, fallbackText: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    return localizedApiErrorMessage({
      code: body.error?.code,
      fallbackMessage: body.error?.message,
      fallbackText,
      locale,
      status: response.status
    });
  } catch {
    return fallbackText || t("videoRequestFailed", { status: response.status });
  }
}
