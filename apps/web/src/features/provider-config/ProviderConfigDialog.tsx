import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bot,
  CheckCircle2,
  Database,
  Film,
  GripVertical,
  KeyRound,
  Loader2,
  LogOut,
  RefreshCcw,
  Save,
  Server,
  ShieldCheck,
  UserRound,
  X
} from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useState, type PointerEvent, type ReactNode } from "react";
import {
  PROVIDER_SOURCE_IDS,
  VIDEO_PROVIDER_KINDS,
  type AgentLlmConfigView,
  type AuthStatusResponse,
  type ProviderConfigResponse,
  type ProviderSourceId,
  type ProviderSourceView,
  type SaveAgentLlmConfigRequest,
  type SaveProviderConfigRequest,
  type SaveVideoProviderConfig,
  type VideoProviderConfigView,
  type VideoProviderKind
} from "@gpt-image-canvas/shared";
import { localizedApiErrorMessage, useI18n, type Locale, type Translate } from "../../shared/i18n";
import { PROVIDER_CONFIG_SAVED_EVENT } from "../../shared/provider-config-events";

interface ProviderConfigDialogProps {
  isAuthLoading: boolean;
  isCodexStarting: boolean;
  onClose: () => void;
  onLogoutCodex: () => Promise<void>;
  onRefreshAgentConfig: () => Promise<AgentLlmConfigView | null>;
  onRefreshAuthStatus: () => Promise<AuthStatusResponse | null>;
  onStartCodexLogin: () => Promise<void>;
}

interface LocalProviderFormState {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: string;
}

interface AgentLlmFormState {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: string;
  supportsVision: boolean;
}

interface VideoProviderFormState {
  kind: VideoProviderKind;
  apiKey: string;
  baseUrl: string;
  videoModel: string;
  textToVideoUrl: string;
  imageToVideoUrl: string;
  statusUrl: string;
  timeoutMs: string;
  pollIntervalMs: string;
  ffmpegPath: string;
  width: string;
  height: string;
  fps: string;
  interpolation: string;
}

type DialogMessageTone = "success" | "error";
type ProviderConfigTab = "image" | "video" | "agent";
type VideoProviderFormMap = Record<VideoProviderKind, VideoProviderFormState>;

const GROK_IMAGINE_VIDEO_MODEL = "grok-imagine-video";

interface DialogMessage {
  tone: DialogMessageTone;
  text: string;
}

const emptyLocalProviderForm: LocalProviderFormState = {
  apiKey: "",
  baseUrl: "",
  model: "",
  timeoutMs: "1200000"
};

const emptyAgentLlmForm: AgentLlmFormState = {
  apiKey: "",
  baseUrl: "",
  model: "",
  timeoutMs: "60000",
  supportsVision: false
};

const emptyVideoProviderForm: VideoProviderFormState = {
  kind: "keyframe-image",
  apiKey: "",
  baseUrl: "",
  videoModel: "",
  textToVideoUrl: "",
  imageToVideoUrl: "",
  statusUrl: "",
  timeoutMs: "1200000",
  pollIntervalMs: "2000",
  ffmpegPath: "",
  width: "3840",
  height: "2160",
  fps: "24",
  interpolation: "ffmpeg"
};

const emptyVideoProviderForms: VideoProviderFormMap = {
  "keyframe-image": { ...emptyVideoProviderForm, kind: "keyframe-image" },
  "custom-http": { ...emptyVideoProviderForm, kind: "custom-http" },
  "grok-imagine": {
    ...emptyVideoProviderForm,
    kind: "grok-imagine",
    videoModel: GROK_IMAGINE_VIDEO_MODEL
  }
};

export function ProviderConfigDialog({
  isAuthLoading,
  isCodexStarting,
  onClose,
  onLogoutCodex,
  onRefreshAgentConfig,
  onRefreshAuthStatus,
  onStartCodexLogin
}: ProviderConfigDialogProps) {
  const { formatDateTime: formatLocaleDateTime, locale, t } = useI18n();
  const [config, setConfig] = useState<ProviderConfigResponse | null>(null);
  const [agentConfig, setAgentConfig] = useState<AgentLlmConfigView | null>(null);
  const [sourceOrder, setSourceOrder] = useState<ProviderSourceId[]>([...PROVIDER_SOURCE_IDS]);
  const [localForm, setLocalForm] = useState<LocalProviderFormState>(emptyLocalProviderForm);
  const [agentForm, setAgentForm] = useState<AgentLlmFormState>(emptyAgentLlmForm);
  const [selectedVideoKind, setSelectedVideoKind] = useState<VideoProviderKind>("keyframe-image");
  const [videoForms, setVideoForms] = useState<VideoProviderFormMap>(emptyVideoProviderForms);
  const [isLoading, setIsLoading] = useState(true);
  const [isAgentConfigLoading, setIsAgentConfigLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<DialogMessage | null>(null);
  const [draggingSourceId, setDraggingSourceId] = useState<ProviderSourceId | null>(null);
  const [activeTab, setActiveTab] = useState<ProviderConfigTab>("image");

  const sourcesById = useMemo(() => {
    return new Map((config?.sources ?? []).map((source) => [source.id, source]));
  }, [config]);

  const activeSourceId = config?.activeSource?.id;
  const localApiKeyMask = config?.localOpenAI.apiKey.value;
  const hasSavedLocalKey = Boolean(config?.localOpenAI.apiKey.hasSecret);
  const videoForm = videoForms[selectedVideoKind];
  const selectedVideoConfig = config?.videoConfigs[selectedVideoKind];
  const videoApiKeyMask = selectedVideoConfig?.apiKey.value;
  const hasSavedVideoKey = Boolean(selectedVideoConfig?.apiKey.hasSecret);
  const savedVideoKind = config?.video.kind;
  const agentApiKeyMask = agentConfig?.apiKey.value;
  const hasSavedAgentKey = Boolean(agentConfig?.apiKey.hasSecret);
  const codexSource = sourcesById.get("codex");
  const codex = codexSource?.details.codex;
  const envSource = sourcesById.get("env-openai");
  const localSource = sourcesById.get("local-openai");
  const activeSource = activeSourceId ? sourcesById.get(activeSourceId) : undefined;
  const availableSourceCount = sourceOrder.filter((sourceId) => sourcesById.get(sourceId)?.available).length;
  const activeSourceRank = activeSourceId ? sourceOrder.indexOf(activeSourceId) + 1 : 0;
  const activeSourceTimeout = activeSource?.details.timeoutMs;

  const loadProviderConfig = useCallback(
    async (signal?: AbortSignal): Promise<ProviderConfigResponse | null> => {
      setIsLoading(true);
      setMessage(null);

      try {
        const response = await fetch("/api/provider-config", { signal });
        if (!response.ok) {
          throw new Error(await readProviderConfigError(response, locale, t));
        }

        const body = (await response.json()) as ProviderConfigResponse;
        if (signal?.aborted) {
          return null;
        }

        applyProviderConfig(body);
        return body;
      } catch (error) {
        if (!signal?.aborted) {
          setMessage({
            tone: "error",
            text: error instanceof Error ? error.message : t("providerConfigLoadFailed")
          });
        }
        return null;
      } finally {
        if (!signal?.aborted) {
          setIsLoading(false);
        }
      }
    },
    [locale, t]
  );

  const loadAgentConfig = useCallback(
    async (signal?: AbortSignal): Promise<AgentLlmConfigView | null> => {
      setIsAgentConfigLoading(true);
      setMessage(null);

      try {
        const response = await fetch("/api/agent-config", { signal });
        if (!response.ok) {
          throw new Error(await readProviderConfigError(response, locale, t));
        }

        const body = (await response.json()) as AgentLlmConfigView;
        if (signal?.aborted) {
          return null;
        }

        applyAgentConfig(body);
        return body;
      } catch (error) {
        if (!signal?.aborted) {
          setMessage({
            tone: "error",
            text: error instanceof Error ? error.message : t("agentConfigLoadFailed")
          });
        }
        return null;
      } finally {
        if (!signal?.aborted) {
          setIsAgentConfigLoading(false);
        }
      }
    },
    [locale, t]
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadProviderConfig(controller.signal);
    void loadAgentConfig(controller.signal);

    return () => {
      controller.abort();
    };
  }, [loadAgentConfig, loadProviderConfig]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  function applyProviderConfig(nextConfig: ProviderConfigResponse): void {
    setConfig(nextConfig);
    setSourceOrder(nextConfig.sourceOrder);
    setLocalForm({
      apiKey: "",
      baseUrl: nextConfig.localOpenAI.baseUrl,
      model: nextConfig.localOpenAI.model,
      timeoutMs: String(nextConfig.localOpenAI.timeoutMs)
    });
    setSelectedVideoKind(nextConfig.video.kind);
    setVideoForms(videoFormsFromConfig(nextConfig));
  }

  function applyAgentConfig(nextConfig: AgentLlmConfigView): void {
    setAgentConfig(nextConfig);
    setAgentForm({
      apiKey: "",
      baseUrl: nextConfig.baseUrl,
      model: nextConfig.model,
      timeoutMs: String(nextConfig.timeoutMs),
      supportsVision: nextConfig.supportsVision
    });
  }

  function updateLocalForm(patch: Partial<LocalProviderFormState>): void {
    setLocalForm((current) => ({
      ...current,
      ...patch
    }));
    setMessage(null);
  }

  function updateAgentForm(patch: Partial<AgentLlmFormState>): void {
    setAgentForm((current) => ({
      ...current,
      ...patch
    }));
    setMessage(null);
  }

  function updateVideoForm(patch: Partial<VideoProviderFormState>): void {
    setVideoForms((current) => ({
      ...current,
      [selectedVideoKind]: {
        ...current[selectedVideoKind],
        ...patch
      }
    }));
    setMessage(null);
  }

  function updateVideoKind(kind: VideoProviderKind): void {
    setSelectedVideoKind(kind);
    setVideoForms((current) => ({
      ...current,
      [kind]: ensureVideoProviderDefaults(current[kind], kind)
    }));
    setMessage(null);
  }

  function moveSource(sourceId: ProviderSourceId, direction: -1 | 1): void {
    setSourceOrder((current) => {
      const sourceIndex = current.indexOf(sourceId);
      const targetIndex = sourceIndex + direction;
      if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }

      const nextOrder = [...current];
      const [removed] = nextOrder.splice(sourceIndex, 1);
      nextOrder.splice(targetIndex, 0, removed);
      return nextOrder;
    });
    setMessage(null);
  }

  function moveSourceToDropTarget(sourceId: ProviderSourceId, targetId: ProviderSourceId, pointerY: number, targetRow: HTMLElement): void {
    if (sourceId === targetId) {
      return;
    }

    setSourceOrder((current) => {
      const targetIndex = current.indexOf(targetId);
      if (targetIndex < 0) {
        return current;
      }

      const rowRect = targetRow.getBoundingClientRect();
      const insertIndex = pointerY < rowRect.top + rowRect.height / 2 ? targetIndex : targetIndex + 1;
      const sourceIndex = current.indexOf(sourceId);
      if (sourceIndex < 0) {
        return current;
      }

      const adjustedIndex = sourceIndex < insertIndex ? insertIndex - 1 : insertIndex;
      if (sourceIndex === adjustedIndex) {
        return current;
      }

      const nextOrder = [...current];
      const [removed] = nextOrder.splice(sourceIndex, 1);
      nextOrder.splice(Math.max(0, Math.min(adjustedIndex, nextOrder.length)), 0, removed);
      return nextOrder;
    });
    setMessage(null);
  }

  function handlePriorityPointerDown(event: PointerEvent<HTMLButtonElement>, sourceId: ProviderSourceId): void {
    if (event.button !== 0) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingSourceId(sourceId);
  }

  function handlePriorityPointerMove(event: PointerEvent<HTMLButtonElement>, sourceId: ProviderSourceId): void {
    if (draggingSourceId !== sourceId) {
      return;
    }

    const target = document.elementFromPoint(event.clientX, event.clientY);
    const row = target?.closest<HTMLElement>("[data-provider-source-id]");
    if (!row) {
      return;
    }

    const targetId = row?.dataset.providerSourceId as ProviderSourceId | undefined;
    if (!targetId || !PROVIDER_SOURCE_IDS.includes(targetId)) {
      return;
    }

    moveSourceToDropTarget(sourceId, targetId, event.clientY, row);
  }

  function handlePriorityPointerEnd(event: PointerEvent<HTMLButtonElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraggingSourceId(null);
  }

  async function saveProviderConfig(): Promise<void> {
    if (!config) {
      return;
    }

    const timeoutMs = Number.parseInt(localForm.timeoutMs, 10);
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      setMessage({
        tone: "error",
        text: t("providerLocalTimeoutInvalid")
      });
      return;
    }

    const videoPayload = buildVideoProviderPayload(videoForm, selectedVideoConfig);
    if (!videoPayload) {
      setMessage({
        tone: "error",
        text: t("providerVideoNumberInvalid")
      });
      return;
    }

    const shouldPersistAgentConfig = shouldSaveAgentConfig(agentForm, hasSavedAgentKey);
    const agentTimeoutMs = Number.parseInt(agentForm.timeoutMs, 10);
    const agentApiKey = agentForm.apiKey.trim();
    const agentModel = agentForm.model.trim();
    if (shouldPersistAgentConfig && !agentApiKey && !hasSavedAgentKey) {
      setMessage({
        tone: "error",
        text: t("agentConfigApiKeyRequired")
      });
      return;
    }
    if (shouldPersistAgentConfig && !agentModel) {
      setMessage({
        tone: "error",
        text: t("agentConfigModelRequired")
      });
      return;
    }
    if (shouldPersistAgentConfig && (!Number.isInteger(agentTimeoutMs) || agentTimeoutMs <= 0)) {
      setMessage({
        tone: "error",
        text: t("agentConfigTimeoutInvalid")
      });
      return;
    }

    setIsSaving(true);
    setMessage(null);

    const apiKey = localForm.apiKey.trim();
    const body: SaveProviderConfigRequest = {
      sourceOrder,
      localOpenAI: {
        apiKey,
        preserveApiKey: !apiKey && hasSavedLocalKey,
        baseUrl: localForm.baseUrl.trim(),
        model: localForm.model.trim(),
        timeoutMs
      },
      video: videoPayload
    };
    const agentBody: SaveAgentLlmConfigRequest | null = shouldPersistAgentConfig
      ? {
          apiKey: agentApiKey,
          preserveApiKey: !agentApiKey && hasSavedAgentKey,
          baseUrl: agentForm.baseUrl.trim(),
          model: agentModel,
          timeoutMs: agentTimeoutMs,
          supportsVision: agentForm.supportsVision
        }
      : null;

    try {
      const response = await fetch("/api/provider-config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        throw new Error(await readProviderConfigError(response, locale, t));
      }

      const savedConfig = (await response.json()) as ProviderConfigResponse;
      let savedAgentConfig: AgentLlmConfigView | null = null;
      if (agentBody) {
        const agentResponse = await fetch("/api/agent-config", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(agentBody)
        });
        if (!agentResponse.ok) {
          throw new Error(await readProviderConfigError(agentResponse, locale, t));
        }
        savedAgentConfig = (await agentResponse.json()) as AgentLlmConfigView;
      }

      applyProviderConfig(savedConfig);
      if (savedAgentConfig) {
        applyAgentConfig(savedAgentConfig);
      }
      window.dispatchEvent(new Event(PROVIDER_CONFIG_SAVED_EVENT));
      await Promise.all([onRefreshAuthStatus(), onRefreshAgentConfig()]);
      setMessage({
        tone: "success",
        text: savedConfig.activeSource
          ? t("providerConfigSavedWithSource", { source: sourceLabel(savedConfig.activeSource.id, t) })
          : t("providerConfigSavedNoSource")
      });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : t("providerConfigSaveFailed")
      });
    } finally {
      setIsSaving(false);
    }
  }

  function enableVideoProvider(kind: VideoProviderKind): void {
    if (isSaving) {
      return;
    }

    updateVideoKind(kind);
  }

  async function handleLogoutCodex(): Promise<void> {
    await onLogoutCodex();
    await loadProviderConfig();
  }

  function handleStartCodexLogin(): void {
    void onStartCodexLogin();
  }

  const dialog = (
    <div className="provider-config-backdrop app-modal-backdrop" data-testid="provider-config-dialog" role="presentation" onClick={onClose}>
      <div
        aria-labelledby="provider-config-title"
        aria-modal="true"
        className="provider-config-dialog app-modal-surface"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="provider-config-dialog__header">
          <div className="provider-config-dialog__title-group">
            <p>{t("navSettings")}</p>
            <h2 id="provider-config-title">{t("providerConfigTitle")}</h2>
          </div>
          <button aria-label={t("providerCloseConfig")} className="provider-config-dialog__close" type="button" onClick={onClose}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="provider-config-dialog__body">
          {isLoading ? (
            <div className="provider-config-loading" data-testid="provider-config-loading" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {t("providerConfigLoading")}
            </div>
          ) : null}

          {message ? (
            <div className={`provider-config-message provider-config-message--${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>
              {message.tone === "success" ? <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" /> : <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />}
              <p>{message.text}</p>
            </div>
          ) : null}

          <nav
            className="provider-config-tabs"
            aria-label={t("providerConfigTabsLabel")}
            data-active-tab={activeTab}
            data-testid="provider-config-tabs"
            role="tablist"
          >
            <button
              aria-controls="provider-config-panel-image"
              aria-selected={activeTab === "image"}
              className="provider-config-tab"
              data-active={activeTab === "image"}
              data-testid="provider-config-tab-image"
              id="provider-config-tab-image"
              role="tab"
              tabIndex={activeTab === "image" ? 0 : -1}
              type="button"
              onClick={() => setActiveTab("image")}
            >
              <Server className="size-4" aria-hidden="true" />
              <span className="provider-config-tab__copy">
                <strong>{t("providerImageModelTab")}</strong>
                <span>{activeSourceId ? t("providerCurrent", { source: sourceLabel(activeSourceId, t) }) : t("providerCurrentNone")}</span>
              </span>
            </button>
            <button
              aria-controls="provider-config-panel-video"
              aria-selected={activeTab === "video"}
              className="provider-config-tab"
              data-active={activeTab === "video"}
              data-testid="provider-config-tab-video"
              id="provider-config-tab-video"
              role="tab"
              tabIndex={activeTab === "video" ? 0 : -1}
              type="button"
              onClick={() => setActiveTab("video")}
            >
              <Film className="size-4" aria-hidden="true" />
              <span className="provider-config-tab__copy">
                <strong>{t("providerVideoTab")}</strong>
                <span>{config?.video.configured ? t("providerAvailable") : t("providerUnavailable")}</span>
              </span>
            </button>
            <button
              aria-controls="provider-config-panel-agent"
              aria-selected={activeTab === "agent"}
              className="provider-config-tab"
              data-active={activeTab === "agent"}
              data-testid="provider-config-tab-agent"
              id="provider-config-tab-agent"
              role="tab"
              tabIndex={activeTab === "agent" ? 0 : -1}
              type="button"
              onClick={() => setActiveTab("agent")}
            >
              <Bot className="size-4" aria-hidden="true" />
              <span className="provider-config-tab__copy">
                <strong>{t("agentLlmTitle")}</strong>
                <span>{isAgentConfigLoading ? t("agentConfigLoading") : agentConfig?.configured ? t("providerAvailable") : t("providerUnavailable")}</span>
              </span>
            </button>
          </nav>

          {activeTab === "image" ? (
            <div
              aria-labelledby="provider-config-tab-image"
              className="provider-config-tab-panel"
              data-tab="image"
              data-testid="provider-image-panel"
              id="provider-config-panel-image"
              key="image"
              role="tabpanel"
            >
              <section className="provider-overview-card" data-mode="image">
                <div className="provider-overview-card__copy">
                  <span className="provider-overview-card__eyebrow">{t("providerImageModelTab")}</span>
                  <div className="provider-overview-card__headline">
                    <span className="provider-overview-card__icon">
                      <SourceIcon sourceId={activeSourceId ?? "env-openai"} />
                    </span>
                    <div className="min-w-0">
                      <h3>{activeSourceId ? sourceLabel(activeSourceId, t) : t("providerCurrentNone")}</h3>
                      <p>{providerOverviewCopy(activeSourceId, t)}</p>
                    </div>
                  </div>
                </div>
                <div className="provider-overview-metrics">
                  <ProviderMetric label={t("providerFieldAvailability")} value={`${availableSourceCount}/${sourceOrder.length}`} />
                  <ProviderMetric label={t("providerPriorityTitle")} value={activeSourceRank > 0 ? `${activeSourceRank}/${sourceOrder.length}` : `0/${sourceOrder.length}`} />
                  <ProviderMetric label={t("providerFieldTimeout")} value={formatTimeout(activeSourceTimeout, t)} />
                </div>
              </section>

              <div className="provider-workspace">
                <div className="provider-workspace__main">
                  <section className="provider-detail-card provider-detail-card--local" data-testid="provider-local-section" aria-labelledby="provider-local-title">
                    <ProviderDetailHeader description={t("providerCardLocalHint")} source={localSource} sourceId="local-openai" titleId="provider-local-title" />
                    <div className="provider-form-grid">
                      <label className="provider-field provider-field--span">
                        <span>API Key</span>
                        <input
                          autoComplete="off"
                          className="provider-field__control"
                          data-testid="provider-local-api-key"
                          name="localOpenAIKey"
                          placeholder={localApiKeyMask ? t("providerLocalApiKeySaved", { mask: localApiKeyMask }) : t("providerLocalApiKeyPlaceholder")}
                          type="password"
                          value={localForm.apiKey}
                          onChange={(event) => updateLocalForm({ apiKey: event.target.value })}
                        />
                      </label>
                      <label className="provider-field provider-field--span">
                        <span>Base URL</span>
                        <input
                          className="provider-field__control"
                          data-testid="provider-local-base-url"
                          name="localOpenAIBaseUrl"
                          placeholder={t("providerBaseUrlPlaceholder")}
                          value={localForm.baseUrl}
                          onChange={(event) => updateLocalForm({ baseUrl: event.target.value })}
                        />
                      </label>
                      <label className="provider-field">
                        <span>{t("providerFieldModel")}</span>
                        <input
                          className="provider-field__control"
                          data-testid="provider-local-model"
                          name="localOpenAIModel"
                          value={localForm.model}
                          onChange={(event) => updateLocalForm({ model: event.target.value })}
                        />
                      </label>
                      <label className="provider-field">
                        <span>{t("providerTimeoutMs")}</span>
                        <input
                          className="provider-field__control"
                          data-testid="provider-local-timeout"
                          min={1}
                          name="localOpenAITimeout"
                          type="number"
                          value={localForm.timeoutMs}
                          onChange={(event) => updateLocalForm({ timeoutMs: event.target.value })}
                        />
                      </label>
                    </div>
                    {hasSavedLocalKey && !localForm.apiKey ? (
                      <div className="provider-secret-pill">
                        <KeyRound className="size-3.5 shrink-0" aria-hidden="true" />
                        {t("providerLocalApiKeySaved", { mask: localApiKeyMask ?? "" })}
                      </div>
                    ) : null}
                  </section>
                </div>

                <div className="provider-workspace__side">
                  <section className="provider-config-priority" aria-labelledby="provider-priority-title">
                    <div className="provider-section-heading">
                      <div className="provider-section-heading__copy">
                        <h3 id="provider-priority-title">{t("providerPriorityTitle")}</h3>
                        <p>{t("providerPriorityNote")}</p>
                      </div>
                      <span>{activeSourceId ? t("providerCurrent", { source: sourceLabel(activeSourceId, t) }) : t("providerCurrentNone")}</span>
                    </div>

                    <ol className="provider-priority-list" data-testid="provider-priority-list">
                      {sourceOrder.map((sourceId, index) => {
                        const source = sourcesById.get(sourceId);
                        return (
                          <li
                            className="provider-priority-item"
                            data-active={activeSourceId === sourceId}
                            data-dragging={draggingSourceId === sourceId}
                            data-provider-source-id={sourceId}
                            data-testid={`provider-priority-${sourceId}`}
                            key={sourceId}
                            title={sourceStatusCopy(source, t)}
                          >
                            <button
                              aria-label={t("providerDragSource", { source: sourceLabel(sourceId, t) })}
                              className="provider-priority-item__drag"
                              type="button"
                              onPointerCancel={handlePriorityPointerEnd}
                              onPointerDown={(event) => handlePriorityPointerDown(event, sourceId)}
                              onPointerMove={(event) => handlePriorityPointerMove(event, sourceId)}
                              onPointerUp={handlePriorityPointerEnd}
                            >
                              <GripVertical className="size-4" aria-hidden="true" />
                            </button>
                            <span className="provider-priority-item__rank">{index + 1}</span>
                            <span className="provider-priority-item__icon">
                              <SourceIcon sourceId={sourceId} />
                            </span>
                            <span className="provider-priority-item__copy">
                              <strong>{sourceLabel(sourceId, t)}</strong>
                              <span>{sourceStatusCopy(source, t)}</span>
                            </span>
                            <span className="provider-priority-item__badge" data-available={source?.available ?? false}>
                              {source?.available ? t("providerAvailable") : t("providerUnavailable")}
                            </span>
                            <span className="provider-priority-item__buttons">
                              <button
                                aria-label={t("providerMoveUp", { source: sourceLabel(sourceId, t) })}
                                className="provider-icon-button"
                                disabled={index === 0}
                                type="button"
                                onClick={() => moveSource(sourceId, -1)}
                              >
                                <ArrowUp className="size-3.5" aria-hidden="true" />
                              </button>
                              <button
                                aria-label={t("providerMoveDown", { source: sourceLabel(sourceId, t) })}
                                className="provider-icon-button"
                                disabled={index === sourceOrder.length - 1}
                                type="button"
                                onClick={() => moveSource(sourceId, 1)}
                              >
                                <ArrowDown className="size-3.5" aria-hidden="true" />
                              </button>
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  </section>

                  <details className="provider-source-catalog">
                    <summary className="provider-source-catalog__summary">
                      <div className="provider-section-heading">
                        <div className="provider-section-heading__copy">
                          <h3 id="provider-source-catalog-title">{t("providerSourcesTitle")}</h3>
                          <p>{t("providerSourcesNote")}</p>
                        </div>
                      </div>
                    </summary>

                    <div className="provider-source-catalog__body">
                      <div className="provider-source-catalog__list">
                        <ProviderSourceMini description={t("providerCardEnvHint")} source={envSource} sourceId="env-openai">
                          <MiniRow label={t("providerFieldModel")} value={envSource?.details.model || "gpt-image-2"} />
                          <MiniRow label={t("providerFieldBaseUrl")} value={envSource?.details.baseUrl || t("providerApiOfficial")} />
                          <MiniRow label={t("providerFieldTimeout")} value={formatTimeout(envSource?.details.timeoutMs, t)} />
                          <MiniRow label="Key" masked value={envSource?.secret.value ?? (envSource?.secret.hasSecret ? t("commonSaved") : t("commonNotSet"))} />
                        </ProviderSourceMini>

                        <ProviderSourceMini
                          action={
                            codex?.available ? (
                              <button className="secondary-action h-10" disabled={isAuthLoading} data-testid="provider-codex-logout" type="button" onClick={() => void handleLogoutCodex()}>
                                {isAuthLoading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <LogOut className="size-4" aria-hidden="true" />}
                                {t("providerLogoutCodex")}
                              </button>
                            ) : (
                              <button
                                className="secondary-action h-10"
                                disabled={isAuthLoading || isCodexStarting}
                                data-testid="provider-codex-login"
                                type="button"
                                onClick={handleStartCodexLogin}
                              >
                                {isCodexStarting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <KeyRound className="size-4" aria-hidden="true" />}
                                {t("providerLoginCodex")}
                              </button>
                            )
                          }
                          description={codex?.available ? t("providerStatusCodexCopy") : sourceStatusCopy(codexSource, t)}
                          source={codexSource}
                          sourceId="codex"
                        >
                          <MiniRow label={t("providerFieldAccount")} value={codex?.email ?? codex?.accountId ?? t("providerLoggedOut")} />
                          <MiniRow label={t("providerFieldExpiresAt")} value={formatOptionalDateTime(codex?.expiresAt, formatLocaleDateTime, t)} />
                          <MiniRow label={t("providerFieldRefreshedAt")} value={formatOptionalDateTime(codex?.refreshedAt, formatLocaleDateTime, t)} />
                        </ProviderSourceMini>
                      </div>
                    </div>
                  </details>
                </div>
              </div>
            </div>
          ) : activeTab === "video" ? (
            <div
              aria-labelledby="provider-config-tab-video"
              className="provider-config-tab-panel provider-config-tab-panel--agent"
              data-tab="video"
              data-testid="provider-video-panel"
              id="provider-config-panel-video"
              key="video"
              role="tabpanel"
            >
              <div className="provider-workspace provider-workspace--agent">
                <section className="provider-overview-card" data-mode="video">
                  <div className="provider-overview-card__copy">
                    <span className="provider-overview-card__eyebrow">{t("providerVideoTab")}</span>
                    <div className="provider-overview-card__headline">
                      <span className="provider-overview-card__icon">
                        <Film className="size-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <h3>{videoKindLabel(videoForm.kind, t)}</h3>
                        <p>{t("providerVideoDescription")}</p>
                      </div>
                    </div>
                  </div>
                  <div className="provider-overview-metrics">
                    <ProviderMetric label={t("providerFieldAvailability")} value={selectedVideoConfig?.configured ? t("providerAvailable") : t("providerUnavailable")} />
                    <ProviderMetric label={t("providerVideoSource")} value={selectedVideoConfig?.source === "environment" ? t("providerVideoSourceEnv") : t("providerVideoSourceLocal")} />
                    <ProviderMetric label={t("providerVideoResolution")} value={`${videoForm.width}x${videoForm.height}`} />
                  </div>
                </section>

                <section className="provider-detail-card provider-detail-card--agent" data-testid="provider-video-section" aria-labelledby="provider-video-title">
                  <header className="provider-detail-card__header">
                    <span className="provider-detail-card__icon">
                      <Film className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h3 id="provider-video-title">{t("providerVideoTab")}</h3>
                      <p>{t("providerVideoCardHint")}</p>
                    </div>
                    <ProviderAvailabilityBadge available={config?.video.configured ?? false} />
                  </header>

                  <div className="provider-video-kind-grid" aria-label={t("providerVideoKind")} role="list">
                    {VIDEO_PROVIDER_KINDS.map((kind) => {
                      const providerConfig = config?.videoConfigs[kind];
                      const isSelected = selectedVideoKind === kind;
                      const isSavedActive = savedVideoKind === kind;
                      return (
                        <article className="provider-video-kind-card" data-active={isSavedActive} data-selected={isSelected} key={kind} role="listitem">
                          <button
                            aria-pressed={isSelected}
                            className="provider-video-kind-card__select"
                            data-testid={`provider-video-kind-${kind}`}
                            type="button"
                            onClick={() => updateVideoKind(kind)}
                          >
                            <span className="provider-video-kind-card__title">{videoKindLabel(kind, t)}</span>
                            <span className="provider-video-kind-card__meta">
                              {providerConfig?.configured ? t("providerAvailable") : t("providerUnavailable")}
                            </span>
                          </button>
                          <button
                            className="provider-video-kind-card__action"
                            data-testid={`provider-video-enable-${kind}`}
                            disabled={isSaving || isSavedActive}
                            type="button"
                            onClick={() => enableVideoProvider(kind)}
                          >
                            {isSavedActive ? t("providerVideoInUse") : t("providerVideoEnable")}
                          </button>
                        </article>
                      );
                    })}
                  </div>

                  <div className="provider-form-grid">
                    <label className="provider-field provider-field--span">
                      <span>API Key</span>
                      <input
                        autoComplete="off"
                        className="provider-field__control"
                        data-testid="provider-video-api-key"
                        name="videoProviderKey"
                        placeholder={videoApiKeyMask ? t("providerVideoApiKeySaved", { mask: videoApiKeyMask }) : t("providerVideoApiKeyPlaceholder")}
                        type="password"
                        value={videoForm.apiKey}
                        onChange={(event) => updateVideoForm({ apiKey: event.target.value })}
                      />
                    </label>
                    <label className="provider-field provider-field--span">
                      <span>{videoForm.kind === "keyframe-image" ? t("providerVideoImageBaseUrl") : t("providerFieldBaseUrl")}</span>
                      <input
                        className="provider-field__control"
                        data-testid="provider-video-base-url"
                        name="videoProviderBaseUrl"
                        placeholder={videoForm.kind === "grok-imagine" ? t("providerVideoGrokBaseUrlPlaceholder") : videoForm.kind === "keyframe-image" ? t("providerBaseUrlPlaceholder") : t("providerVideoBaseUrlPlaceholder")}
                        value={videoForm.baseUrl}
                        onChange={(event) => updateVideoForm({ baseUrl: event.target.value })}
                      />
                    </label>
                    {videoForm.kind === "grok-imagine" ? (
                      <label className="provider-field provider-field--span">
                        <span>{t("providerFieldModel")}</span>
                        <input
                          className="provider-field__control"
                          data-testid="provider-video-model"
                          name="videoProviderModel"
                          placeholder={GROK_IMAGINE_VIDEO_MODEL}
                          value={videoForm.videoModel}
                          onChange={(event) => updateVideoForm({ videoModel: event.target.value })}
                        />
                      </label>
                    ) : null}
                    {videoForm.kind === "custom-http" ? (
                      <>
                        <label className="provider-field provider-field--span">
                          <span>{t("providerVideoTextUrl")}</span>
                          <input
                            className="provider-field__control"
                            data-testid="provider-video-text-url"
                            name="videoProviderTextUrl"
                            placeholder={t("providerVideoTextUrlPlaceholder")}
                            value={videoForm.textToVideoUrl}
                            onChange={(event) => updateVideoForm({ textToVideoUrl: event.target.value })}
                          />
                        </label>
                        <label className="provider-field provider-field--span">
                          <span>{t("providerVideoImageUrl")}</span>
                          <input
                            className="provider-field__control"
                            data-testid="provider-video-image-url"
                            name="videoProviderImageUrl"
                            placeholder={t("providerVideoImageUrlPlaceholder")}
                            value={videoForm.imageToVideoUrl}
                            onChange={(event) => updateVideoForm({ imageToVideoUrl: event.target.value })}
                          />
                        </label>
                      </>
                    ) : videoForm.kind === "keyframe-image" ? (
                      <label className="provider-field provider-field--span">
                        <span>FFmpeg</span>
                        <input
                          className="provider-field__control"
                          data-testid="provider-video-ffmpeg-path"
                          name="videoProviderFfmpegPath"
                          placeholder="ffmpeg"
                          value={videoForm.ffmpegPath}
                          onChange={(event) => updateVideoForm({ ffmpegPath: event.target.value })}
                        />
                      </label>
                    ) : null}
                    <label className="provider-field">
                      <span>{t("providerTimeoutMs")}</span>
                      <input
                        className="provider-field__control"
                        data-testid="provider-video-timeout"
                        min={1}
                        name="videoProviderTimeout"
                        type="number"
                        value={videoForm.timeoutMs}
                        onChange={(event) => updateVideoForm({ timeoutMs: event.target.value })}
                      />
                    </label>
                    <label className="provider-field">
                      <span>{t("providerVideoPollInterval")}</span>
                      <input
                        className="provider-field__control"
                        data-testid="provider-video-poll-interval"
                        min={1}
                        name="videoProviderPollInterval"
                        type="number"
                        value={videoForm.pollIntervalMs}
                        onChange={(event) => updateVideoForm({ pollIntervalMs: event.target.value })}
                      />
                    </label>
                    <label className="provider-field">
                      <span>{t("providerVideoWidth")}</span>
                      <input
                        className="provider-field__control"
                        data-testid="provider-video-width"
                        min={1}
                        name="videoProviderWidth"
                        type="number"
                        value={videoForm.width}
                        onChange={(event) => updateVideoForm({ width: event.target.value })}
                      />
                    </label>
                    <label className="provider-field">
                      <span>{t("providerVideoHeight")}</span>
                      <input
                        className="provider-field__control"
                        data-testid="provider-video-height"
                        min={1}
                        name="videoProviderHeight"
                        type="number"
                        value={videoForm.height}
                        onChange={(event) => updateVideoForm({ height: event.target.value })}
                      />
                    </label>
                    <label className="provider-field">
                      <span>FPS</span>
                      <input
                        className="provider-field__control"
                        data-testid="provider-video-fps"
                        min={1}
                        name="videoProviderFps"
                        type="number"
                        value={videoForm.fps}
                        onChange={(event) => updateVideoForm({ fps: event.target.value })}
                      />
                    </label>
                    <label className="provider-field">
                      <span>{t("providerVideoInterpolation")}</span>
                      <input
                        className="provider-field__control"
                        data-testid="provider-video-interpolation"
                        name="videoProviderInterpolation"
                        value={videoForm.interpolation}
                        onChange={(event) => updateVideoForm({ interpolation: event.target.value })}
                      />
                    </label>
                  </div>
                  {hasSavedVideoKey && !videoForm.apiKey ? (
                    <div className="provider-secret-pill">
                      <KeyRound className="size-3.5 shrink-0" aria-hidden="true" />
                      {t("providerVideoApiKeySaved", { mask: videoApiKeyMask ?? "" })}
                    </div>
                  ) : null}
                </section>
              </div>
            </div>
          ) : (
            <div
              aria-labelledby="provider-config-tab-agent"
              className="provider-config-tab-panel provider-config-tab-panel--agent"
              data-tab="agent"
              data-testid="provider-agent-panel"
              id="provider-config-panel-agent"
              key="agent"
              role="tabpanel"
            >
              <div className="provider-workspace provider-workspace--agent">
                <section className="provider-detail-card provider-detail-card--agent" data-testid="provider-agent-section" aria-labelledby="provider-agent-title">
                  <header className="provider-detail-card__header">
                    <span className="provider-detail-card__icon">
                      <Bot className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h3 id="provider-agent-title">{t("agentLlmTitle")}</h3>
                      <p>{t("agentLlmDescription")}</p>
                    </div>
                    <ProviderAvailabilityBadge available={agentConfig?.configured ?? false} />
                  </header>
                  <div className="provider-form-grid">
                    <label className="provider-field provider-field--span">
                      <span>API Key</span>
                      <input
                        autoComplete="off"
                        className="provider-field__control"
                        data-testid="provider-agent-api-key"
                        name="agentLlmKey"
                        placeholder={agentApiKeyMask ? t("agentConfigApiKeySaved", { mask: agentApiKeyMask }) : t("agentConfigApiKeyPlaceholder")}
                        type="password"
                        value={agentForm.apiKey}
                        onChange={(event) => updateAgentForm({ apiKey: event.target.value })}
                      />
                    </label>
                    <label className="provider-field provider-field--span">
                      <span>Base URL</span>
                      <input
                        className="provider-field__control"
                        data-testid="provider-agent-base-url"
                        name="agentLlmBaseUrl"
                        placeholder={t("agentConfigBaseUrlPlaceholder")}
                        value={agentForm.baseUrl}
                        onChange={(event) => updateAgentForm({ baseUrl: event.target.value })}
                      />
                    </label>
                    <label className="provider-field provider-field--span">
                      <span>{t("providerFieldModel")}</span>
                      <input
                        className="provider-field__control"
                        data-testid="provider-agent-model"
                        name="agentLlmModel"
                        placeholder={t("agentConfigModelPlaceholder")}
                        value={agentForm.model}
                        onChange={(event) => updateAgentForm({ model: event.target.value })}
                      />
                    </label>
                    <label className="provider-field">
                      <span>{t("providerTimeoutMs")}</span>
                      <input
                        className="provider-field__control"
                        data-testid="provider-agent-timeout"
                        min={1}
                        name="agentLlmTimeout"
                        type="number"
                        value={agentForm.timeoutMs}
                        onChange={(event) => updateAgentForm({ timeoutMs: event.target.value })}
                      />
                    </label>
                    <label className="provider-toggle-field">
                      <input
                        checked={agentForm.supportsVision}
                        data-testid="provider-agent-supports-vision"
                        type="checkbox"
                        onChange={(event) => updateAgentForm({ supportsVision: event.target.checked })}
                      />
                      <span>{t("agentConfigSupportsVision")}</span>
                    </label>
                  </div>
                  {hasSavedAgentKey && !agentForm.apiKey ? (
                    <div className="provider-secret-pill">
                      <KeyRound className="size-3.5 shrink-0" aria-hidden="true" />
                      {t("agentConfigApiKeySaved", { mask: agentApiKeyMask ?? "" })}
                    </div>
                  ) : null}
                </section>

              </div>
            </div>
          )}
        </div>

        <footer className="provider-config-dialog__footer">
          <button
            className="secondary-action h-10"
            disabled={isLoading || isAgentConfigLoading || isSaving}
            type="button"
            onClick={() => {
              void loadProviderConfig();
              void loadAgentConfig();
            }}
          >
            <RefreshCcw className="size-4" aria-hidden="true" />
            {t("providerRefresh")}
          </button>
          <button className="primary-action h-10" data-testid="provider-config-save" disabled={isLoading || isAgentConfigLoading || isSaving || !config} type="button" onClick={() => void saveProviderConfig()}>
            {isSaving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
            {t("providerSave")}
          </button>
        </footer>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}

function ProviderDetailHeader({
  description,
  source,
  sourceId,
  titleId
}: {
  description?: string;
  source: ProviderSourceView | undefined;
  sourceId: ProviderSourceId;
  titleId: string;
}) {
  const { t } = useI18n();

  return (
    <header className="provider-detail-card__header">
      <span className="provider-detail-card__icon">
        <SourceIcon sourceId={sourceId} />
      </span>
      <div className="min-w-0">
        <h3 id={titleId}>{sourceLabel(sourceId, t)}</h3>
        {description ? <p>{description}</p> : null}
      </div>
      <ProviderAvailabilityBadge available={source?.available ?? false} />
    </header>
  );
}

function ProviderSourceMini({
  action,
  children,
  description,
  source,
  sourceId
}: {
  action?: ReactNode;
  children: ReactNode;
  description?: string;
  source: ProviderSourceView | undefined;
  sourceId: ProviderSourceId;
}) {
  const { t } = useI18n();

  return (
    <section className="provider-source-mini" data-available={source?.available ?? false} data-testid={`provider-${sourceId}-mini`}>
      <header className="provider-source-mini__header">
        <span className="provider-source-mini__icon">
          <SourceIcon sourceId={sourceId} />
        </span>
        <div className="provider-source-mini__copy">
          <h3>{sourceLabel(sourceId, t)}</h3>
          {description ? <p>{description}</p> : null}
        </div>
        <ProviderAvailabilityBadge available={source?.available ?? false} />
      </header>
      <dl className="provider-mini-grid">{children}</dl>
      {action ? <div className="provider-source-mini__action">{action}</div> : null}
    </section>
  );
}

function ProviderAvailabilityBadge({ available }: { available: boolean }) {
  const { t } = useI18n();

  return (
    <span className="provider-source-status" data-available={available}>
      {available ? <ShieldCheck className="size-3.5" aria-hidden="true" /> : <AlertTriangle className="size-3.5" aria-hidden="true" />}
      {available ? t("providerAvailable") : t("providerUnavailable")}
    </span>
  );
}

function ProviderMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="provider-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MiniRow({ label, masked = false, value }: { label: string; masked?: boolean; value: string }) {
  return (
    <div className="provider-mini-row">
      <dt>{label}</dt>
      <dd data-masked={masked}>{value}</dd>
    </div>
  );
}

function SourceIcon({ sourceId }: { sourceId: ProviderSourceId }) {
  if (sourceId === "env-openai") {
    return <Server className="size-4" aria-hidden="true" />;
  }

  if (sourceId === "local-openai") {
    return <Database className="size-4" aria-hidden="true" />;
  }

  return <UserRound className="size-4" aria-hidden="true" />;
}

function sourceLabel(sourceId: ProviderSourceId, t: Translate): string {
  return t("sourceLabel", { sourceId });
}

function sourceStatusCopy(source: ProviderSourceView | undefined, t: Translate): string {
  if (!source) {
    return t("providerSourcePending");
  }

  if (source.available) {
    return t("providerSourceConfigured");
  }

  if (source.id === "codex") {
    return source.details.codex?.unavailableReason || t("providerSourceMissingCodex");
  }

  if (source.id === "local-openai") {
    return t("providerSourceMissingKey");
  }

  return t("providerSourceMissingOpenAIKey");
}

function formatTimeout(value: number | undefined, t: Translate): string {
  if (!value) {
    return t("commonNotSet");
  }

  return `${value} ms`;
}

function formatOptionalDateTime(value: string | undefined, formatDateTime: (value: string) => string, t: Translate): string {
  if (!value) {
    return t("commonNotRecorded");
  }

  return formatDateTime(value);
}

function providerOverviewCopy(sourceId: ProviderSourceId | undefined, t: Translate): string {
  if (sourceId === "env-openai") {
    return t("providerStatusEnvCopy");
  }

  if (sourceId === "local-openai") {
    return t("providerStatusLocalCopy");
  }

  if (sourceId === "codex") {
    return t("providerStatusCodexCopy");
  }

  return t("providerStatusNoneCopy");
}

function videoKindLabel(kind: VideoProviderKind, t: Translate): string {
  if (kind === "grok-imagine") {
    return t("providerVideoKindGrokImagine");
  }

  return kind === "custom-http" ? t("providerVideoKindCustomHttp") : t("providerVideoKindKeyframe");
}

function videoFormsFromConfig(config: ProviderConfigResponse): VideoProviderFormMap {
  return VIDEO_PROVIDER_KINDS.reduce<VideoProviderFormMap>((forms, kind) => {
    forms[kind] = videoFormFromConfig(config.videoConfigs[kind] ?? config.video, kind);
    return forms;
  }, { ...emptyVideoProviderForms });
}

function videoFormFromConfig(config: VideoProviderConfigView, kind: VideoProviderKind): VideoProviderFormState {
  return ensureVideoProviderDefaults(
    {
      kind,
      apiKey: "",
      baseUrl: config.baseUrl,
      videoModel: config.videoModel,
      textToVideoUrl: config.textToVideoUrl,
      imageToVideoUrl: config.imageToVideoUrl,
      statusUrl: config.statusUrl,
      timeoutMs: String(config.timeoutMs),
      pollIntervalMs: String(config.pollIntervalMs),
      ffmpegPath: config.ffmpegPath,
      width: String(config.width),
      height: String(config.height),
      fps: String(config.fps),
      interpolation: config.interpolation
    },
    kind
  );
}

function ensureVideoProviderDefaults(form: VideoProviderFormState, kind: VideoProviderKind): VideoProviderFormState {
  if (kind !== "grok-imagine") {
    return {
      ...form,
      kind
    };
  }

  return {
    ...form,
    kind,
    baseUrl: form.baseUrl,
    videoModel: form.videoModel.trim() || GROK_IMAGINE_VIDEO_MODEL
  };
}

function buildVideoProviderPayload(
  form: VideoProviderFormState,
  savedConfig: VideoProviderConfigView | undefined
): SaveVideoProviderConfig | null {
  const videoTimeoutMs = Number.parseInt(form.timeoutMs, 10);
  const videoPollIntervalMs = Number.parseInt(form.pollIntervalMs, 10);
  const videoWidth = Number.parseInt(form.width, 10);
  const videoHeight = Number.parseInt(form.height, 10);
  const videoFps = Number.parseInt(form.fps, 10);
  if (
    !Number.isInteger(videoTimeoutMs) ||
    videoTimeoutMs <= 0 ||
    !Number.isInteger(videoPollIntervalMs) ||
    videoPollIntervalMs <= 0 ||
    !Number.isInteger(videoWidth) ||
    videoWidth <= 0 ||
    !Number.isInteger(videoHeight) ||
    videoHeight <= 0 ||
    !Number.isInteger(videoFps) ||
    videoFps <= 0
  ) {
    return null;
  }

  const videoApiKey = form.apiKey.trim();
  return {
    kind: form.kind,
    apiKey: videoApiKey,
    preserveApiKey: !videoApiKey && Boolean(savedConfig?.apiKey.hasSecret),
    baseUrl: form.baseUrl.trim(),
    videoModel: form.videoModel.trim(),
    model: form.videoModel.trim(),
    textToVideoUrl: form.textToVideoUrl.trim(),
    imageToVideoUrl: form.imageToVideoUrl.trim(),
    statusUrl: form.statusUrl.trim(),
    timeoutMs: videoTimeoutMs,
    pollIntervalMs: videoPollIntervalMs,
    ffmpegPath: form.ffmpegPath.trim(),
    width: videoWidth,
    height: videoHeight,
    fps: videoFps,
    interpolation: form.interpolation.trim()
  };
}

function shouldSaveAgentConfig(form: AgentLlmFormState, hasSavedApiKey: boolean): boolean {
  return Boolean(
    hasSavedApiKey ||
      form.apiKey.trim() ||
      form.baseUrl.trim() ||
      form.model.trim() ||
      form.supportsVision
  );
}

async function readProviderConfigError(response: Response, locale: Locale, t: Translate): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    return localizedApiErrorMessage({
      code: body.error?.code,
      fallbackMessage: body.error?.message,
      fallbackText: t("providerConfigRequestFailed", { status: response.status }),
      locale,
      status: response.status
    });
  } catch {
    return t("providerConfigRequestFailed", { status: response.status });
  }
}
