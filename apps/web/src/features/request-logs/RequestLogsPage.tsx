import { AlertTriangle, Check, Clock3, Copy, FileText, Loader2, Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  RequestLogCategory,
  RequestLogEntry,
  RequestLogListResponse,
  RequestLogService
} from "@gpt-image-canvas/shared";
import { localizedApiErrorMessage, useI18n, type Locale, type Translate } from "../../shared/i18n";
import { writeClipboardText } from "../../shared/clipboard";
import { copyableLogValue, formatLogValue, previewLogValue } from "./request-log-display";

type ServiceFilter = RequestLogService | "all";
type CategoryFilter = RequestLogCategory | "all";

const serviceOptions: Array<{ labelKey: string; value: ServiceFilter }> = [
  { value: "all", labelKey: "requestLogServiceAll" },
  { value: "image", labelKey: "requestLogServiceImage" },
  { value: "video", labelKey: "requestLogServiceVideo" },
  { value: "agent", labelKey: "requestLogServiceAgent" }
];

const categoryOptions: Array<{ labelKey: string; value: CategoryFilter }> = [
  { value: "all", labelKey: "requestLogCategoryAll" },
  { value: "text_to_image", labelKey: "requestLogCategoryTextToImage" },
  { value: "image_to_image", labelKey: "requestLogCategoryImageToImage" },
  { value: "text_to_video", labelKey: "requestLogCategoryTextToVideo" },
  { value: "image_to_video", labelKey: "requestLogCategoryImageToVideo" },
  { value: "agent", labelKey: "requestLogCategoryAgent" }
];

export function RequestLogsPage() {
  const { formatDateTime, locale, t } = useI18n();
  const [service, setService] = useState<ServiceFilter>("all");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [items, setItems] = useState<RequestLogEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [retentionHours, setRetentionHours] = useState(6);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) ?? items[0],
    [items, selectedId]
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadRequestLogs({
      category,
      locale,
      service,
      signal: controller.signal,
      t
    })
      .then((response) => {
        if (controller.signal.aborted) {
          return;
        }
        setItems(response.items);
        setRetentionHours(response.retentionHours);
        setSelectedId((current) => (response.items.some((item) => item.id === current) ? current : (response.items[0]?.id ?? "")));
        setError("");
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : t("requestLogsLoadFailed"));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    setIsLoading(true);
    return () => {
      controller.abort();
    };
  }, [category, locale, service, t]);

  return (
    <main className="request-logs-page app-view" data-testid="request-logs-page">
      <header className="request-logs-header">
        <div>
          <span className="request-logs-header__eyebrow">{t("requestLogsEyebrow")}</span>
          <h1>{t("requestLogsTitle")}</h1>
          <p>{t("requestLogsDeck", { hours: retentionHours })}</p>
        </div>
        <div className="request-logs-summary" aria-label={t("requestLogsRetention")}>
          <Clock3 className="size-4" aria-hidden="true" />
          <span>{t("requestLogsRetentionValue", { hours: retentionHours })}</span>
        </div>
      </header>

      <section className="request-logs-filters" aria-label={t("requestLogsFilters")}>
        <SegmentedFilter
          label={t("requestLogServiceLabel")}
          options={serviceOptions}
          value={service}
          onChange={(value) => setService(value as ServiceFilter)}
        />
        <SegmentedFilter
          label={t("requestLogCategoryLabel")}
          options={categoryOptions}
          value={category}
          onChange={(value) => setCategory(value as CategoryFilter)}
        />
      </section>

      {error ? (
        <div className="request-logs-alert" role="alert">
          <AlertTriangle className="size-4" aria-hidden="true" />
          {error}
        </div>
      ) : null}

      <section className="request-logs-layout">
        <div className="request-logs-list" aria-label={t("requestLogsList")}>
          {isLoading ? (
            <div className="request-logs-empty" role="status">
              <Loader2 className="size-5 animate-spin" aria-hidden="true" />
              <span>{t("requestLogsLoading")}</span>
            </div>
          ) : items.length === 0 ? (
            <div className="request-logs-empty">
              <FileText className="size-5" aria-hidden="true" />
              <span>{t("requestLogsEmpty")}</span>
            </div>
          ) : (
            items.map((item) => (
              <button
                className="request-log-row"
                data-active={selectedItem?.id === item.id}
                data-testid="request-log-row"
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
              >
                <span className="request-log-row__topline">
                  <strong>{categoryLabel(item.category, t)}</strong>
                  <span>{formatDateTime(item.createdAt)}</span>
                </span>
                <span className="request-log-row__path">{item.method} {item.path}</span>
                <span className="request-log-row__meta">
                  {serviceLabel(item.service, t)} · {item.providerKind} · {statusLabel(item, t)}
                </span>
              </button>
            ))
          )}
        </div>

        <RequestLogDetail item={selectedItem} />
      </section>
    </main>
  );
}

function SegmentedFilter({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ labelKey: string; value: string }>;
  value: string;
}) {
  const { t } = useI18n();
  return (
    <div className="request-logs-filter">
      <span>{label}</span>
      <div className="request-logs-filter__buttons">
        {options.map((option) => (
          <button
            data-active={value === option.value}
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
          >
            {t(option.labelKey as never)}
          </button>
        ))}
      </div>
    </div>
  );
}

function RequestLogDetail({ item }: { item: RequestLogEntry | undefined }) {
  const { formatDateTime, t } = useI18n();
  const [isExpanded, setIsExpanded] = useState(false);
  if (!item) {
    return (
      <aside className="request-log-detail request-log-detail--empty">
        <FileText className="size-5" aria-hidden="true" />
        <p>{t("requestLogsSelectEmpty")}</p>
      </aside>
    );
  }

  return (
    <aside className="request-log-detail" data-testid="request-log-detail">
      <header className="request-log-detail__header">
        <div>
          <span>{serviceLabel(item.service, t)} / {categoryLabel(item.category, t)}</span>
          <h2>{item.method} {item.path}</h2>
        </div>
        <div className="request-log-detail__actions">
          <button
            className="request-log-action-button"
            data-testid="request-log-expand-toggle"
            type="button"
            onClick={() => setIsExpanded((current) => !current)}
          >
            {isExpanded ? <Minimize2 className="size-3.5" aria-hidden="true" /> : <Maximize2 className="size-3.5" aria-hidden="true" />}
            {isExpanded ? t("requestLogCollapse") : t("requestLogExpand")}
          </button>
          <strong>{statusLabel(item, t)}</strong>
        </div>
      </header>

      <dl className="request-log-detail__meta">
        <div>
          <dt>{t("requestLogCreatedAt")}</dt>
          <dd>{formatDateTime(item.createdAt)}</dd>
        </div>
        <div>
          <dt>{t("requestLogProvider")}</dt>
          <dd>{item.providerKind}</dd>
        </div>
        <div>
          <dt>{t("requestLogDuration")}</dt>
          <dd>{item.durationMs === undefined ? "-" : `${item.durationMs}ms`}</dd>
        </div>
      </dl>

      <LogBlock expanded={isExpanded} title={t("requestLogUrl")} value={item.url} />
      <LogBlock expanded={isExpanded} title={t("requestLogHeaders")} value={item.requestHeaders} />
      <LogBlock expanded={isExpanded} title={t("requestLogBody")} value={item.requestBody} />
      <LogBlock expanded={isExpanded} title={t("requestLogResponse")} value={item.error ? { error: item.error } : item.responseBodyPreview} />
    </aside>
  );
}

function LogBlock({ expanded, title, value }: { expanded: boolean; title: string; value: unknown }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const visibleValue = expanded ? formatLogValue(value) : previewLogValue(value);

  async function copyLogValue(): Promise<void> {
    await writeClipboardText(copyableLogValue(value));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <section className="request-log-block">
      <header className="request-log-block__header">
        <h3>{title}</h3>
        <button
          className="request-log-copy-button"
          data-testid="request-log-copy-button"
          title={t("requestLogCopy")}
          type="button"
          onClick={() => void copyLogValue()}
        >
          {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
          {copied ? t("requestLogCopied") : t("requestLogCopy")}
        </button>
      </header>
      <pre data-expanded={expanded}>{visibleValue}</pre>
    </section>
  );
}

async function loadRequestLogs(input: {
  category: CategoryFilter;
  locale: Locale;
  service: ServiceFilter;
  signal: AbortSignal;
  t: Translate;
}): Promise<RequestLogListResponse> {
  const params = new URLSearchParams({ limit: "100" });
  if (input.service !== "all") {
    params.set("service", input.service);
  }
  if (input.category !== "all") {
    params.set("category", input.category);
  }

  const response = await fetch(`/api/request-logs?${params.toString()}`, { signal: input.signal });
  if (!response.ok) {
    throw new Error(await readRequestLogError(response, input.locale, input.t));
  }

  return (await response.json()) as RequestLogListResponse;
}

async function readRequestLogError(response: Response, locale: Locale, t: Translate): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    return localizedApiErrorMessage({
      code: body.error?.code,
      fallbackMessage: body.error?.message,
      fallbackText: t("requestLogsRequestFailed", { status: response.status }),
      locale,
      status: response.status
    });
  } catch {
    return t("requestLogsRequestFailed", { status: response.status });
  }
}

function serviceLabel(service: RequestLogService, t: Translate): string {
  return t(`requestLogService${capitalize(service)}` as never);
}

function categoryLabel(category: RequestLogCategory, t: Translate): string {
  const labels: Record<RequestLogCategory, string> = {
    text_to_image: t("requestLogCategoryTextToImage"),
    image_to_image: t("requestLogCategoryImageToImage"),
    text_to_video: t("requestLogCategoryTextToVideo"),
    image_to_video: t("requestLogCategoryImageToVideo"),
    agent: t("requestLogCategoryAgent")
  };
  return labels[category];
}

function statusLabel(item: RequestLogEntry, t: Translate): string {
  if (item.error) {
    return t("requestLogStatusError");
  }
  return item.responseStatus === undefined ? "-" : String(item.responseStatus);
}

function capitalize(value: RequestLogService): "Image" | "Video" | "Agent" {
  return value === "image" ? "Image" : value === "video" ? "Video" : "Agent";
}

export default RequestLogsPage;
