import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bot,
  CheckCircle2,
  Database,
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
  type AgentLlmConfigView,
  type AuthStatusResponse,
  type ProviderConfigResponse,
  type ProviderSourceId,
  type ProviderSourceView,
  type SaveAgentLlmConfigRequest,
  type SaveProviderConfigRequest
} from "@gpt-image-canvas/shared";
import { localizedApiErrorMessage, useI18n, type Locale, type Translate } from "../../shared/i18n";

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

type DialogMessageTone = "success" | "error";
type ProviderConfigTab = "image" | "agent";

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
      }
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
