import { CheckCircle2, CircleStop, ImageIcon, Loader2, Play, RotateCcw, XCircle } from "lucide-react";
import { BaseBoxShapeUtil, HTMLContainer, RecordProps, T, TLShape, useEditor } from "tldraw";
import type {
  GenerationDependencyEdge,
  GeneratedAsset,
  GenerationJob,
  GenerationJobRole,
  GenerationJobStatus,
  GenerationOutput,
  GenerationPlan,
  GenerationPlanStatus,
  GenerationReference,
  GenerationReferenceUsage,
  OutputStatus
} from "@gpt-image-canvas/shared";
import { useI18n, type Locale } from "../../shared/i18n";

export const AGENT_PLAN_NODE_TYPE = "agent-plan-node" as const;
export const AGENT_PLAN_NODE_ACTION_EVENT = "gpt-image-canvas:agent-plan-node-action" as const;
export const AGENT_PLAN_NODE_WIDTH = 456;
export const AGENT_PLAN_NODE_HEIGHT = 560;

export type AgentPlanNodeActionType = "execute" | "cancel" | "retry_failed";

export interface AgentPlanNodeActionDetail {
  action: AgentPlanNodeActionType;
  planId: string;
  shapeId: string;
  lastRunId?: string;
}

export interface AgentPlanNodeProps {
  plan: unknown;
  w: number;
  h: number;
  selectedJobId: string;
  lastRunId: string;
}

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    [AGENT_PLAN_NODE_TYPE]: AgentPlanNodeProps;
  }
}

export type AgentPlanNodeShape = TLShape<typeof AGENT_PLAN_NODE_TYPE>;

type PlanStatusTone = "idle" | "active" | "success" | "warning" | "danger";

export interface GenerationPlanOutputSummary {
  finalImageCount: number;
  supportImageCount: number;
  totalImageCount: number;
  jobCount: number;
}

const planStatuses: readonly GenerationPlanStatus[] = [
  "awaiting_confirmation",
  "confirmed",
  "running",
  "succeeded",
  "partial",
  "failed",
  "cancelled"
];
const jobStatuses: readonly GenerationJobStatus[] = ["queued", "running", "succeeded", "failed", "blocked", "cancelled"];
const outputStatuses: readonly OutputStatus[] = ["succeeded", "failed"];
const jobRoles: readonly GenerationJobRole[] = [
  "final_image",
  "variation",
  "character_anchor",
  "style_anchor",
  "reference_anchor"
];
const referenceUsages: readonly GenerationReferenceUsage[] = [
  "subject",
  "character",
  "style",
  "composition",
  "scene",
  "product",
  "other"
];

const labels: Record<Locale, {
  actions: Record<AgentPlanNodeActionType, string>;
  badPlanCopy: string;
  badPlanTitle: string;
  count: (count: number) => string;
  countLabel: string;
  dependencies: string;
  dependencyChip: (jobId: string) => string;
  detailTitle: string;
  emptySlot: string;
  emptyOutputSummary: string;
  errorFallback: string;
  errorLabel: string;
  finalOutputCount: (count: number) => string;
  generatedReference: (jobId: string) => string;
  jobs: string;
  noDependencies: string;
  noOutputs: string;
  noReferences: string;
  outputFailed: string;
  outputCount: (count: number) => string;
  outputReady: string;
  outputSlot: (index: number) => string;
  outputs: string;
  prompt: string;
  references: string;
  roleLabel: string;
  role: Record<GenerationJobRole, string>;
  selectedReference: string;
  statusLabel: string;
  status: Record<GenerationPlanStatus, string>;
  supportOutputCount: (count: number) => string;
  jobStatus: Record<GenerationJobStatus, string>;
  usage: Record<GenerationReferenceUsage, string>;
}> = {
  "zh-CN": {
    actions: {
      execute: "执行计划",
      cancel: "取消",
      retry_failed: "重试失败"
    },
    badPlanCopy: "快照中的计划节点数据已损坏，已安全保留节点但不执行任何操作。",
    badPlanTitle: "无法读取 Agent 计划",
    count: (count) => `${count} 张`,
    countLabel: "数量",
    dependencies: "依赖",
    dependencyChip: (jobId) => `依赖 ${jobId}`,
    detailTitle: "任务详情",
    emptySlot: "等待缩略图",
    emptyOutputSummary: "暂无输出图",
    errorFallback: "任务失败，暂无更多错误信息。",
    errorLabel: "错误",
    finalOutputCount: (count) => `${count} 张最终图`,
    generatedReference: (jobId) => `来自 ${jobId}`,
    jobs: "任务",
    noDependencies: "无依赖",
    noOutputs: "没有输出槽",
    noReferences: "无引用",
    outputFailed: "输出失败",
    outputCount: (count) => `预计 ${count} 张图`,
    outputReady: "缩略图已就绪",
    outputSlot: (index) => `输出 ${index}`,
    outputs: "输出槽",
    prompt: "完整提示词",
    references: "参考",
    roleLabel: "角色",
    role: {
      final_image: "最终图",
      variation: "变体",
      character_anchor: "角色锚点",
      style_anchor: "风格锚点",
      reference_anchor: "参考锚点"
    },
    selectedReference: "画布参考",
    statusLabel: "状态",
    status: {
      awaiting_confirmation: "待确认",
      confirmed: "已确认",
      running: "执行中",
      succeeded: "已完成",
      partial: "部分完成",
      failed: "失败",
      cancelled: "已取消"
    },
    supportOutputCount: (count) => `${count} 张支持图`,
    jobStatus: {
      queued: "排队",
      running: "生成中",
      succeeded: "完成",
      failed: "失败",
      blocked: "阻塞",
      cancelled: "取消"
    },
    usage: {
      subject: "主体",
      character: "角色",
      style: "风格",
      composition: "构图",
      scene: "场景",
      product: "产品",
      other: "参考"
    }
  },
  en: {
    actions: {
      execute: "Execute plan",
      cancel: "Cancel",
      retry_failed: "Retry failed"
    },
    badPlanCopy: "This saved plan node has malformed data. The node is preserved safely and no actions are available.",
    badPlanTitle: "Agent plan unreadable",
    count: (count) => `${count} images`,
    countLabel: "Count",
    dependencies: "Deps",
    dependencyChip: (jobId) => `Depends on ${jobId}`,
    detailTitle: "Job details",
    emptySlot: "Thumbnail pending",
    emptyOutputSummary: "No output images",
    errorFallback: "Job failed without more detail.",
    errorLabel: "Error",
    finalOutputCount: (count) => `${count} final ${count === 1 ? "image" : "images"}`,
    generatedReference: (jobId) => `From ${jobId}`,
    jobs: "Jobs",
    noDependencies: "No dependencies",
    noOutputs: "No output slots",
    noReferences: "No references",
    outputFailed: "Output failed",
    outputCount: (count) => `${count} expected images`,
    outputReady: "Thumbnail ready",
    outputSlot: (index) => `Output ${index}`,
    outputs: "Output slots",
    prompt: "Full prompt",
    references: "Refs",
    roleLabel: "Role",
    role: {
      final_image: "Final",
      variation: "Variation",
      character_anchor: "Character anchor",
      style_anchor: "Style anchor",
      reference_anchor: "Reference anchor"
    },
    selectedReference: "Canvas reference",
    statusLabel: "Status",
    status: {
      awaiting_confirmation: "Awaiting confirmation",
      confirmed: "Confirmed",
      running: "Running",
      succeeded: "Complete",
      partial: "Partial",
      failed: "Failed",
      cancelled: "Cancelled"
    },
    supportOutputCount: (count) => `${count} support ${count === 1 ? "image" : "images"}`,
    jobStatus: {
      queued: "Queued",
      running: "Generating",
      succeeded: "Done",
      failed: "Failed",
      blocked: "Blocked",
      cancelled: "Cancelled"
    },
    usage: {
      subject: "Subject",
      character: "Character",
      style: "Style",
      composition: "Composition",
      scene: "Scene",
      product: "Product",
      other: "Reference"
    }
  }
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function isGenerationReference(value: unknown): value is GenerationReference {
  if (!isRecord(value) || !isOneOf(value.usage, referenceUsages)) {
    return false;
  }

  if (value.kind === "selected_canvas_image") {
    return value.assetId === undefined || typeof value.assetId === "string";
  }

  if (value.kind === "generated_output") {
    return typeof value.jobId === "string" && (value.outputId === undefined || typeof value.outputId === "string");
  }

  return false;
}

function isGeneratedAsset(value: unknown): value is GeneratedAsset {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.url === "string" &&
    typeof value.fileName === "string" &&
    typeof value.mimeType === "string" &&
    typeof value.width === "number" &&
    Number.isFinite(value.width) &&
    typeof value.height === "number" &&
    Number.isFinite(value.height) &&
    (value.cloud === undefined || isRecord(value.cloud))
  );
}

function isGenerationOutput(value: unknown): value is GenerationOutput {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isOneOf(value.status, outputStatuses) &&
    (value.asset === undefined || isGeneratedAsset(value.asset)) &&
    (value.error === undefined || typeof value.error === "string")
  );
}

function isGenerationJob(value: unknown): value is GenerationJob {
  const count = isRecord(value) ? value.count : undefined;

  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isOneOf(value.role, jobRoles) &&
    typeof value.prompt === "string" &&
    typeof count === "number" &&
    Number.isFinite(count) &&
    count >= 0 &&
    isOneOf(value.status, jobStatuses) &&
    Array.isArray(value.references) &&
    value.references.every(isGenerationReference) &&
    Array.isArray(value.outputs) &&
    value.outputs.every(isGenerationOutput) &&
    typeof value.visible === "boolean" &&
    (value.error === undefined || typeof value.error === "string")
  );
}

function isGenerationDependencyEdge(value: unknown): value is GenerationDependencyEdge {
  return isRecord(value) && typeof value.fromJobId === "string" && typeof value.toJobId === "string";
}

export function isGenerationPlan(value: unknown): value is GenerationPlan {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    isOneOf(value.status, planStatuses) &&
    isRecord(value.defaults) &&
    Array.isArray(value.jobs) &&
    value.jobs.every(isGenerationJob) &&
    Array.isArray(value.edges) &&
    value.edges.every(isGenerationDependencyEdge) &&
    value.createdBy === "agent" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

export function isAgentPlanNodeShape(shape: unknown): shape is AgentPlanNodeShape {
  return isRecord(shape) && shape.type === AGENT_PLAN_NODE_TYPE;
}

export function isUnexecutedPlanStatus(status: GenerationPlanStatus): boolean {
  return status === "awaiting_confirmation";
}

export function isActivePlanStatus(status: GenerationPlanStatus): boolean {
  return status === "confirmed" || status === "running";
}

export function hasFailedPlanJob(plan: GenerationPlan): boolean {
  return plan.jobs.some((job) => job.status === "failed" || job.status === "blocked");
}

function normalizedJobOutputCount(count: number): number {
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
}

export function summarizeGenerationPlanOutputs(plan: GenerationPlan): GenerationPlanOutputSummary {
  return plan.jobs.reduce<GenerationPlanOutputSummary>(
    (summary, job) => {
      const count = normalizedJobOutputCount(job.count);
      if (job.role === "final_image") {
        summary.finalImageCount += count;
      } else {
        summary.supportImageCount += count;
      }
      summary.totalImageCount += count;
      return summary;
    },
    {
      finalImageCount: 0,
      supportImageCount: 0,
      totalImageCount: 0,
      jobCount: plan.jobs.length
    }
  );
}

export function generationPlanOutputCount(plan: GenerationPlan): number {
  return summarizeGenerationPlanOutputs(plan).totalImageCount;
}

export function createAgentPlanNodeProps(plan: GenerationPlan, lastRunId = ""): AgentPlanNodeProps {
  return {
    plan,
    w: AGENT_PLAN_NODE_WIDTH,
    h: AGENT_PLAN_NODE_HEIGHT,
    selectedJobId: plan.jobs[0]?.id ?? "",
    lastRunId
  };
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function stringOrDefault(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function normalizeAgentPlanForRestore(plan: GenerationPlan): GenerationPlan {
  if (!isActivePlanStatus(plan.status) && !plan.jobs.some((job) => job.status === "running")) {
    return plan;
  }

  return {
    ...plan,
    status: "cancelled",
    updatedAt: new Date().toISOString(),
    jobs: plan.jobs.map((job) =>
      job.status === "running" || (isActivePlanStatus(plan.status) && job.status === "queued")
        ? { ...job, status: "cancelled", error: job.error ?? "Cancelled because the page was refreshed." }
        : job
    )
  };
}

export function normalizeAgentPlanNodePropsForSnapshot(props: unknown): AgentPlanNodeProps {
  if (!isRecord(props)) {
    return {
      plan: null,
      w: AGENT_PLAN_NODE_WIDTH,
      h: AGENT_PLAN_NODE_HEIGHT,
      selectedJobId: "",
      lastRunId: ""
    };
  }

  const rawPlan = props.plan;
  const plan = isGenerationPlan(rawPlan) ? normalizeAgentPlanForRestore(rawPlan) : rawPlan ?? null;

  return {
    plan,
    w: numberOrDefault(props.w, AGENT_PLAN_NODE_WIDTH),
    h: numberOrDefault(props.h, AGENT_PLAN_NODE_HEIGHT),
    selectedJobId: stringOrDefault(props.selectedJobId),
    lastRunId: stringOrDefault(props.lastRunId)
  };
}

function conciseText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/gu, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, Math.max(0, maxLength - 3))}...` : compact;
}

function planStatusTone(status: GenerationPlanStatus): PlanStatusTone {
  switch (status) {
    case "confirmed":
    case "running":
      return "active";
    case "succeeded":
      return "success";
    case "partial":
      return "warning";
    case "failed":
      return "danger";
    case "cancelled":
      return "idle";
    case "awaiting_confirmation":
    default:
      return "idle";
  }
}

function jobStatusIcon(status: GenerationJobStatus) {
  switch (status) {
    case "running":
      return <Loader2 className="agent-plan-node__status-icon animate-spin" aria-hidden="true" />;
    case "succeeded":
      return <CheckCircle2 className="agent-plan-node__status-icon" aria-hidden="true" />;
    case "failed":
    case "blocked":
      return <XCircle className="agent-plan-node__status-icon" aria-hidden="true" />;
    case "cancelled":
      return <CircleStop className="agent-plan-node__status-icon" aria-hidden="true" />;
    case "queued":
    default:
      return null;
  }
}

function dependencyChips(plan: GenerationPlan, job: GenerationJob): string[] {
  return plan.edges.filter((edge) => edge.toJobId === job.id).map((edge) => edge.fromJobId);
}

function referenceChip(reference: GenerationReference, locale: Locale): string {
  const copy = labels[locale];
  const usage = copy.usage[reference.usage];
  if (reference.kind === "generated_output") {
    return `${usage}: ${copy.generatedReference(reference.jobId ?? "?")}`;
  }

  return `${usage}: ${reference.label || reference.assetId || copy.selectedReference}`;
}

function AgentPlanThumbnailSlots({ job, locale }: { job: GenerationJob; locale: Locale }) {
  const slotCount = Math.max(1, Math.min(4, normalizedJobOutputCount(job.count)));
  const outputs = job.outputs.slice(0, slotCount);

  return (
    <div className="agent-plan-node__thumbnail-grid" aria-label={`${job.id} ${labels[locale].outputCount(job.count)}`}>
      {Array.from({ length: slotCount }, (_, index) => {
        const output = outputs[index];
        if (output?.asset?.url) {
          return (
            <div className="agent-plan-node__thumbnail" data-state="filled" key={`${job.id}-thumb-${output.id || index}`}>
              <img src={output.asset.url} alt={`${job.id} ${index + 1}`} />
            </div>
          );
        }

        return (
          <div
            className="agent-plan-node__thumbnail"
            data-state={output?.status === "failed" ? "failed" : "empty"}
            key={`${job.id}-thumb-empty-${index}`}
            title={output?.error || labels[locale].emptySlot}
          >
            {output?.status === "failed" ? <XCircle aria-hidden="true" /> : <ImageIcon aria-hidden="true" />}
          </div>
        );
      })}
    </div>
  );
}

function detailOutputSlots(job: GenerationJob): Array<GenerationOutput | undefined> {
  const slotCount = Math.max(normalizedJobOutputCount(job.count), job.outputs.length);
  return Array.from({ length: slotCount }, (_, index) => job.outputs[index]);
}

function outputSlotState(output: GenerationOutput | undefined): "empty" | "failed" | "filled" {
  if (output?.status === "failed") {
    return "failed";
  }

  return output?.asset?.url ? "filled" : "empty";
}

function outputSlotDescription(output: GenerationOutput | undefined, locale: Locale): string {
  const copy = labels[locale];
  if (!output) {
    return copy.emptySlot;
  }

  if (output.status === "failed") {
    return output.error || copy.outputFailed;
  }

  return output.asset?.fileName || output.asset?.id || output.id || copy.outputReady;
}

function AgentPlanDetailOutputSlots({ job, locale }: { job: GenerationJob; locale: Locale }) {
  const copy = labels[locale];
  const slots = detailOutputSlots(job);

  if (slots.length === 0) {
    return <p className="agent-plan-node__detail-empty">{copy.noOutputs}</p>;
  }

  return (
    <div className="agent-plan-node__detail-output-grid" aria-label={`${job.id} ${copy.outputs}`}>
      {slots.map((output, index) => {
        const state = outputSlotState(output);
        const description = outputSlotDescription(output, locale);
        return (
          <figure className="agent-plan-node__detail-output" data-state={state} key={`${job.id}-detail-output-${output?.id ?? index}`}>
            <span className="agent-plan-node__detail-output-thumb">
              {output?.asset?.url ? (
                <img src={output.asset.url} alt={`${copy.outputSlot(index + 1)} ${description}`} />
              ) : state === "failed" ? (
                <XCircle aria-hidden="true" />
              ) : (
                <ImageIcon aria-hidden="true" />
              )}
            </span>
            <figcaption>
              <strong>{copy.outputSlot(index + 1)}</strong>
              <small>{description}</small>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

function dispatchPlanAction(shape: AgentPlanNodeShape, plan: GenerationPlan, action: AgentPlanNodeActionType): void {
  window.dispatchEvent(
    new CustomEvent<AgentPlanNodeActionDetail>(AGENT_PLAN_NODE_ACTION_EVENT, {
      detail: {
        action,
        planId: plan.id,
        shapeId: shape.id,
        lastRunId: shape.props.lastRunId || undefined
      }
    })
  );
}

function AgentPlanNodeContent({ shape }: { shape: AgentPlanNodeShape }) {
  const editor = useEditor();
  const { locale } = useI18n();
  const copy = labels[locale];
  const props = normalizeAgentPlanNodePropsForSnapshot(shape.props);
  const plan = isGenerationPlan(props.plan) ? props.plan : undefined;

  if (!plan) {
    return (
      <HTMLContainer className="agent-plan-node is-malformed" data-testid="agent-plan-node" style={{ width: props.w, height: props.h }}>
        <div className="agent-plan-node__empty">
          <XCircle aria-hidden="true" />
          <strong>{copy.badPlanTitle}</strong>
          <p>{copy.badPlanCopy}</p>
        </div>
      </HTMLContainer>
    );
  }

  const selectedJob = plan.jobs.find((job) => job.id === props.selectedJobId) ?? plan.jobs[0];
  const selectedDependencies = selectedJob ? dependencyChips(plan, selectedJob) : [];
  const outputSummary = summarizeGenerationPlanOutputs(plan);
  const summaryParts = [
    outputSummary.finalImageCount > 0 ? copy.finalOutputCount(outputSummary.finalImageCount) : "",
    outputSummary.supportImageCount > 0 ? copy.supportOutputCount(outputSummary.supportImageCount) : ""
  ].filter(Boolean);
  const outputSummaryLabel = summaryParts.join(" · ") || copy.emptyOutputSummary;
  const canExecute = plan.status === "awaiting_confirmation" || plan.status === "confirmed";
  const canCancel = plan.status === "running";
  const canRetry = hasFailedPlanJob(plan);

  return (
    <HTMLContainer
      className="agent-plan-node"
      data-plan-status={plan.status}
      data-testid="agent-plan-node"
      style={{ width: props.w, height: props.h }}
    >
      <div className="agent-plan-node__header">
        <div className="agent-plan-node__title-block">
          <span className="agent-plan-node__eyebrow">Agent plan</span>
          <h2>{plan.title || copy.badPlanTitle}</h2>
        </div>
        <span className="agent-plan-node__status" data-tone={planStatusTone(plan.status)}>
          {copy.status[plan.status]}
        </span>
      </div>

      <div className="agent-plan-node__summary" aria-label={outputSummaryLabel}>
        {summaryParts.length > 0 ? summaryParts.map((part) => <span key={part}>{part}</span>) : <span>{copy.emptyOutputSummary}</span>}
        <span>{plan.jobs.length} {copy.jobs}</span>
      </div>

      <div className="agent-plan-node__actions" onPointerDown={(event) => event.stopPropagation()}>
        <button
          aria-label={`${copy.actions.execute}: ${plan.title}`}
          data-testid="agent-plan-node-execute"
          disabled={!canExecute}
          title={copy.actions.execute}
          type="button"
          onClick={() => dispatchPlanAction(shape, plan, "execute")}
        >
          <Play aria-hidden="true" />
          {copy.actions.execute}
        </button>
        <button
          aria-label={`${copy.actions.cancel}: ${plan.title}`}
          data-testid="agent-plan-node-cancel"
          disabled={!canCancel}
          title={copy.actions.cancel}
          type="button"
          onClick={() => dispatchPlanAction(shape, plan, "cancel")}
        >
          <CircleStop aria-hidden="true" />
          {copy.actions.cancel}
        </button>
        <button
          aria-label={`${copy.actions.retry_failed}: ${plan.title}`}
          data-testid="agent-plan-node-retry"
          disabled={!canRetry}
          title={copy.actions.retry_failed}
          type="button"
          onClick={() => dispatchPlanAction(shape, plan, "retry_failed")}
        >
          <RotateCcw aria-hidden="true" />
          {copy.actions.retry_failed}
        </button>
      </div>

      <div className="agent-plan-node__jobs" aria-label={copy.jobs}>
        {plan.jobs.map((job) => {
          const isSelected = selectedJob?.id === job.id;
          const dependencies = dependencyChips(plan, job);
          return (
            <button
              aria-pressed={isSelected}
              className="agent-plan-node__job-row"
              data-job-status={job.status}
              data-selected={isSelected}
              data-testid="agent-plan-node-job"
              key={job.id}
              type="button"
              onClick={() => {
                editor.updateShapes<AgentPlanNodeShape>([
                  {
                    id: shape.id,
                    type: AGENT_PLAN_NODE_TYPE,
                    props: {
                      selectedJobId: job.id
                    }
                  }
                ]);
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <span className="agent-plan-node__job-main">
                <span className="agent-plan-node__job-meta">
                  <span className="agent-plan-node__role">{copy.role[job.role]}</span>
                  <span className="agent-plan-node__job-id">{job.id}</span>
                  <span className="agent-plan-node__job-count">{copy.count(job.count)}</span>
                </span>
                <span className="agent-plan-node__prompt">{conciseText(job.prompt, 96)}</span>
                {job.error ? <span className="agent-plan-node__error">{conciseText(job.error || copy.errorFallback, 84)}</span> : null}
                {dependencies.length > 0 || job.references.length > 0 ? (
                  <span className="agent-plan-node__chips">
                    {dependencies.map((jobId) => (
                      <span className="agent-plan-node__chip" data-kind="dependency" key={`${job.id}-dep-${jobId}`}>
                        {copy.dependencyChip(jobId)}
                      </span>
                    ))}
                    {job.references.map((reference, index) => (
                      <span className="agent-plan-node__chip" data-kind="reference" key={`${job.id}-ref-${index}`}>
                        {referenceChip(reference, locale)}
                      </span>
                    ))}
                  </span>
                ) : null}
              </span>
              <span className="agent-plan-node__job-side">
                <span className="agent-plan-node__job-status">
                  {jobStatusIcon(job.status)}
                  {copy.jobStatus[job.status]}
                </span>
                <AgentPlanThumbnailSlots job={job} locale={locale} />
              </span>
            </button>
          );
        })}
      </div>

      {selectedJob ? (
        <section className="agent-plan-node__detail" aria-label={`${copy.detailTitle}: ${selectedJob.id}`} onPointerDown={(event) => event.stopPropagation()}>
          <div className="agent-plan-node__detail-grid">
            <div className="agent-plan-node__detail-item">
              <span>{copy.roleLabel}</span>
              <p>{copy.role[selectedJob.role]}</p>
            </div>
            <div className="agent-plan-node__detail-item">
              <span>{copy.countLabel}</span>
              <p>{copy.count(selectedJob.count)}</p>
            </div>
            <div className="agent-plan-node__detail-item">
              <span>{copy.statusLabel}</span>
              <p>{copy.jobStatus[selectedJob.status]}</p>
            </div>
          </div>
          <div className="agent-plan-node__detail-item agent-plan-node__detail-item--full">
            <span>{copy.prompt}</span>
            <p>{selectedJob.prompt || "-"}</p>
          </div>
          <div className="agent-plan-node__detail-grid">
            <div className="agent-plan-node__detail-item">
              <span>{copy.dependencies}</span>
              <p>{selectedDependencies.join(", ") || copy.noDependencies}</p>
            </div>
            <div className="agent-plan-node__detail-item">
              <span>{copy.references}</span>
              <p>{selectedJob.references.map((reference) => referenceChip(reference, locale)).join(", ") || copy.noReferences}</p>
            </div>
          </div>
          <div className="agent-plan-node__detail-item agent-plan-node__detail-item--full">
            <span>{copy.errorLabel}</span>
            <p>{selectedJob.error || "-"}</p>
          </div>
          <div className="agent-plan-node__detail-item agent-plan-node__detail-item--full">
            <span>{copy.outputs}</span>
            <AgentPlanDetailOutputSlots job={selectedJob} locale={locale} />
          </div>
        </section>
      ) : null}
    </HTMLContainer>
  );
}

export class AgentPlanNodeShapeUtil extends BaseBoxShapeUtil<AgentPlanNodeShape> {
  static override type = AGENT_PLAN_NODE_TYPE;
  static override props: RecordProps<AgentPlanNodeShape> = {
    plan: T.any,
    w: T.number,
    h: T.number,
    selectedJobId: T.string,
    lastRunId: T.string
  };

  override canBind(): boolean {
    return false;
  }

  override canResize(): boolean {
    return false;
  }

  override getDefaultProps(): AgentPlanNodeShape["props"] {
    return normalizeAgentPlanNodePropsForSnapshot(undefined);
  }

  override component(shape: AgentPlanNodeShape) {
    return <AgentPlanNodeContent shape={shape} />;
  }

  override indicator(shape: AgentPlanNodeShape) {
    const props = normalizeAgentPlanNodePropsForSnapshot(shape.props);
    return <rect width={props.w} height={props.h} rx={8} ry={8} />;
  }
}
