import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Film,
  ImageIcon,
  Loader2,
  PlaySquare,
  Sparkles,
  X,
  XCircle
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { PROVIDER_CONFIG_SAVED_EVENT } from "../../shared/provider-config-events";

const VIDEO_JOB_POLL_INTERVAL_MS = 1600;
const VIDEO_JOB_POLL_TIMEOUT_MS = 10 * 60 * 1000;

export interface CreativeVideoPageProps {
  initialReferenceAssetId?: string;
  initialPrompt?: string;
  onOpenVideoLibrary: () => void;
  onClearInitialReference?: () => void;
}

export type VideoMode = "text_to_video" | "image_to_video";
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
};

interface VideoProgressSnapshot {
  createdAt: string;
  error?: string;
  jobId?: string;
  progressPercent: number;
  stageText: string;
  status: VideoGenerationStatus;
  updatedAt?: string;
}

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
  const [currentJob, setCurrentJob] = useState<VideoProgressSnapshot | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [providerStatus, setProviderStatus] = useState<VideoProviderStatus | null>(null);
  const [providerLoading, setProviderLoading] = useState(true);
  const [providerError, setProviderError] = useState("");

  const loadProviderStatus = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setProviderLoading(true);
    setProviderError("");

    try {
      const response = await fetch(videoProviderStatusUrl(), { signal });
      if (!response.ok) {
        throw new Error(await readVideoApiError(response, locale, t, t("videoProviderStatusRequestFailed", { status: response.status })));
      }

      const body = (await response.json()) as unknown;
      if (!isVideoProviderStatusResponse(body)) {
        throw new Error(t("videoProviderStatusInvalidData"));
      }

      if (!signal?.aborted) {
        setProviderStatus(body.provider);
      }
    } catch (loadError) {
      if (!signal?.aborted) {
        setProviderError(loadError instanceof Error ? loadError.message : t("videoProviderStatusLoadFailed"));
        setProviderStatus(null);
      }
    } finally {
      if (!signal?.aborted) {
        setProviderLoading(false);
      }
    }
  }, [locale, t]);

  useEffect(() => {
    const controller = new AbortController();

    void loadProviderStatus(controller.signal);

    return () => {
      controller.abort();
    };
  }, [loadProviderStatus]);

  useEffect(() => {
    const refreshProviderStatus = (): void => {
      void loadProviderStatus();
    };

    window.addEventListener(PROVIDER_CONFIG_SAVED_EVENT, refreshProviderStatus);
    return () => {
      window.removeEventListener(PROVIDER_CONFIG_SAVED_EVENT, refreshProviderStatus);
    };
  }, [loadProviderStatus]);

  useEffect(() => {
    setMode((currentMode) => nextVideoModeForProviderStatus(providerStatus, currentMode));
  }, [providerStatus]);

  useEffect(() => {
    if (initialPrompt) {
      setPrompt(initialPrompt);
    }
  }, [initialPrompt]);

  useEffect(() => {
    if (!currentJob || isTerminalVideoStatus(currentJob.status)) {
      return;
    }

    const timerId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [currentJob?.jobId, currentJob?.status]);

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
  const textModeSelectable = canSelectVideoMode(providerStatus, "text_to_video");
  const imageModeSelectable = canSelectVideoMode(providerStatus, "image_to_video");
  const providerReady = Boolean(providerStatus?.configured && modeSupported);
  const providerBlockMessage = providerLoading
    ? t("videoProviderChecking")
    : providerError || providerUnavailableMessage(providerStatus, mode, t);
  const showKeyframeProviderNote = isKeyframeProviderStatus(providerStatus);
  const heroCopy = creativeVideoHeroCopyKeys(providerStatus);
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
    setCurrentJob({
      createdAt: new Date().toISOString(),
      progressPercent: 4,
      stageText: t("videoProgressStageSubmitting"),
      status: "queued"
    });

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

      setCurrentJob(videoJobProgressSnapshot(body.job, t));

      if (body.job.status === "failed") {
        throw new Error(body.job.error?.trim() || t("videoGenerateFailed"));
      }

      if (body.job.status === "succeeded") {
        setStatusMessage(t("videoGenerateSaved"));
      } else {
        setStatusMessage(t("videoGenerateSubmitted"));
        const completedJob = await pollVideoJob(body.job.id, locale, t, (job) => {
          setCurrentJob(videoJobProgressSnapshot(job, t));
        });
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
      const errorMessage = submitError instanceof Error ? submitError.message : t("videoGenerateFailed");
      setError(errorMessage);
      setCurrentJob((current) =>
        current && !isTerminalVideoStatus(current.status)
          ? {
              ...current,
              error: errorMessage,
              progressPercent: 100,
              stageText: t("videoProgressStageFailed"),
              status: "failed",
              updatedAt: new Date().toISOString()
            }
          : current
      );
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
              {t(heroCopy.kicker)}
            </p>
            <h1 id="creative-video-title">{t(heroCopy.title)}</h1>
            <p>{t(heroCopy.deck)}</p>
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
                aria-disabled={!textModeSelectable}
                className="video-mode-card"
                data-selected={mode === "text_to_video"}
                disabled={!textModeSelectable}
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
                aria-disabled={!imageModeSelectable}
                className="video-mode-card"
                data-selected={mode === "image_to_video"}
                disabled={!imageModeSelectable}
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
              {showKeyframeProviderNote ? <p>{t("videoProviderKeyframeNote")}</p> : null}
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

            {shouldShowReferencePicker(providerStatus, mode) ? (
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
            {currentJob ? <VideoProgressCard nowMs={nowMs} progress={currentJob} /> : null}

            <footer className="video-form__footer">
              <p>{providerBlockMessage || (mode === "image_to_video" ? t("videoSubmitImageHint") : t("videoSubmitTextHint"))}</p>
              <button className="video-primary-action" disabled={!canSubmit} type="submit">
                {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
                {submitting ? t("videoWaitingForJob") : t("videoGenerateAction")}
              </button>
            </footer>
          </form>

          <aside className="video-brief-panel" aria-label={t("videoBriefAria")}>
            <span className="video-brief-panel__mark">{t("videoDurationOption", { seconds: durationSeconds })}</span>
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

function VideoProgressCard({ nowMs, progress }: { nowMs: number; progress: VideoProgressSnapshot }) {
  const { t } = useI18n();
  const statusIcon =
    progress.status === "succeeded" ? (
      <CheckCircle2 className="size-4" aria-hidden="true" />
    ) : progress.status === "failed" || progress.status === "cancelled" ? (
      <XCircle className="size-4" aria-hidden="true" />
    ) : (
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
    );
  const elapsedMs = Math.max(0, nowMs - timestampMs(progress.createdAt));
  const percent = clampProgressPercent(progress.progressPercent);

  return (
    <section
      aria-label={t("videoProgressStatusAria", {
        percent,
        status: t("videoStatusValue", { status: progress.status })
      })}
      className="video-progress-card"
      data-status={progress.status}
      role="status"
    >
      <div className="video-progress-card__header">
        <div>
          <p className="video-progress-card__eyebrow">{t("videoProgressCurrentTask")}</p>
          <h2>
            {statusIcon}
            {t("videoStatusValue", { status: progress.status })}
          </h2>
        </div>
        <span className="video-progress-card__percent">{t("videoProgressPercent", { percent })}</span>
      </div>
      <div
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percent}
        className="video-progress-bar"
        role="progressbar"
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <dl className="video-progress-card__meta">
        <div>
          <dt>{t("videoProgressStageLabel")}</dt>
          <dd>{progress.error || progress.stageText}</dd>
        </div>
        <div>
          <dt>{t("videoProgressElapsedLabel")}</dt>
          <dd>{t("videoProgressElapsed", { time: formatElapsedDuration(elapsedMs, t) })}</dd>
        </div>
        {progress.jobId ? (
          <div>
            <dt>{t("videoProgressJobLabel")}</dt>
            <dd>{progress.jobId}</dd>
          </div>
        ) : null}
      </dl>
    </section>
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

function videoJobProgressSnapshot(job: VideoGenerationJobResponse["job"], t: Translate): VideoProgressSnapshot {
  const progressFields = job as VideoGenerationJobResponse["job"] & VideoProgressFields;
  return {
    createdAt: job.createdAt,
    error: job.error,
    jobId: job.id,
    progressPercent: progressPercentForStatus(job.status, readProgressPercent(progressFields)),
    stageText: readStageText(progressFields, job.status, t),
    status: job.status,
    updatedAt: job.updatedAt
  };
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

function isTerminalVideoStatus(status: VideoGenerationStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function nextVideoModeForProviderStatus(provider: VideoProviderStatus | null, currentMode: VideoMode): VideoMode {
  if (!provider || isModeSupported(provider, currentMode)) {
    return currentMode;
  }

  if (provider.supportsTextToVideo) {
    return "text_to_video";
  }

  if (provider.supportsImageToVideo) {
    return "image_to_video";
  }

  return currentMode;
}

export function canSelectVideoMode(provider: VideoProviderStatus | null, mode: VideoMode): boolean {
  return !provider || isModeSupported(provider, mode);
}

export function shouldShowReferencePicker(provider: VideoProviderStatus | null, mode: VideoMode): boolean {
  return mode === "image_to_video" && canSelectVideoMode(provider, "image_to_video");
}

type CreativeVideoHeroCopyKeys = {
  deck: "videoCreativeDeck" | "videoGrokImagineDeck";
  kicker: "videoCreativeKicker" | "videoGrokImagineKicker";
  title: "videoCreativeTitle" | "videoGrokImagineTitle";
};

export function creativeVideoHeroCopyKeys(provider: VideoProviderStatus | null): CreativeVideoHeroCopyKeys {
  return provider?.id === "grok-imagine"
    ? {
        deck: "videoGrokImagineDeck",
        kicker: "videoGrokImagineKicker",
        title: "videoGrokImagineTitle"
      }
    : {
        deck: "videoCreativeDeck",
        kicker: "videoCreativeKicker",
        title: "videoCreativeTitle"
      };
}

function isModeSupported(provider: VideoProviderStatus | null, mode: VideoMode): boolean {
  if (!provider) {
    return false;
  }

  return mode === "image_to_video" ? provider.supportsImageToVideo : provider.supportsTextToVideo;
}

function isKeyframeProviderStatus(provider: VideoProviderStatus | null): boolean {
  if (!provider) {
    return false;
  }

  return provider.id.toLowerCase() === "keyframe-image" || provider.message?.toLowerCase().includes("keyframe") === true;
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

export function videoProviderStatusUrl(): string {
  return "/api/videos/provider-status";
}

function capabilityState(supported: boolean | undefined, t: Translate): string {
  return supported ? t("videoProviderSupported") : t("videoProviderUnsupported");
}

async function pollVideoJob(
  jobId: string,
  locale: Locale,
  t: Translate,
  onProgress: (job: VideoGenerationJobResponse["job"]) => void
): Promise<VideoGenerationJobResponse> {
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

    onProgress(body.job);

    if (isTerminalVideoStatus(body.job.status)) {
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
