import type {
  AgentSelectedCanvasReference,
  GeneratedAsset,
  GenerationOutput,
  GenerationPlan,
  GenerationRecord
} from "./generation.js";
import type { MaskedSecret } from "./provider-config.js";

export interface AgentLlmConfigView {
  configured: boolean;
  apiKey: MaskedSecret;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  supportsVision: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SaveAgentLlmConfigRequest {
  apiKey?: string;
  preserveApiKey?: boolean;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  supportsVision: boolean;
}

export type AgentThinkingType = "enabled" | "disabled";
export type AgentReasoningEffort = "high" | "max";

export interface AgentPlannerOptions {
  thinking?: {
    type: AgentThinkingType;
  };
  reasoningEffort?: AgentReasoningEffort;
}

export type AgentClientMessageType =
  | "user_message"
  | "revise_plan"
  | "execute_plan"
  | "cancel_run"
  | "retry_failed"
  | "ping";

export interface AgentBaseClientMessage {
  type: AgentClientMessageType;
  requestId?: string;
  runId?: string;
}

export interface AgentPingClientMessage extends AgentBaseClientMessage {
  type: "ping";
}

export interface AgentCancelRunClientMessage extends AgentBaseClientMessage {
  type: "cancel_run";
}

export interface AgentUserMessageClientMessage extends AgentBaseClientMessage {
  type: "user_message";
  text: string;
  selectedReferences?: AgentSelectedCanvasReference[];
  selectedReferenceIds?: string[];
  defaults?: Record<string, unknown>;
  plannerOptions?: AgentPlannerOptions;
}

export interface AgentRevisePlanClientMessage extends AgentBaseClientMessage {
  type: "revise_plan";
  planId: string;
  instructions: string;
}

export interface AgentExecutePlanClientMessage extends AgentBaseClientMessage {
  type: "execute_plan";
  planId: string;
  plan?: GenerationPlan;
  selectedReferences?: AgentSelectedCanvasReference[];
}

export interface AgentRetryFailedClientMessage extends AgentBaseClientMessage {
  type: "retry_failed";
  planId: string;
  plan?: GenerationPlan;
  selectedReferences?: AgentSelectedCanvasReference[];
}

export type AgentClientMessage =
  | AgentPingClientMessage
  | AgentCancelRunClientMessage
  | AgentUserMessageClientMessage
  | AgentRevisePlanClientMessage
  | AgentExecutePlanClientMessage
  | AgentRetryFailedClientMessage;

export type AgentServerEventType =
  | "connected"
  | "assistant_delta"
  | "assistant_thinking_delta"
  | "plan_created"
  | "plan_updated"
  | "job_started"
  | "job_completed"
  | "job_failed"
  | "job_blocked"
  | "asset_preview"
  | "run_cancelled"
  | "run_done"
  | "error"
  | "pong";

export interface AgentBaseServerEvent {
  type: AgentServerEventType;
  requestId?: string;
  runId?: string;
  timestamp: string;
}

export interface AgentConnectedEvent extends AgentBaseServerEvent {
  type: "connected";
  connectionId: string;
}

export interface AgentPongEvent extends AgentBaseServerEvent {
  type: "pong";
}

export interface AgentErrorEvent extends AgentBaseServerEvent {
  type: "error";
  code: string;
  message: string;
  recoverable: boolean;
}

export interface AgentAssistantDeltaEvent extends AgentBaseServerEvent {
  type: "assistant_delta";
  delta: string;
}

export interface AgentAssistantThinkingDeltaEvent extends AgentBaseServerEvent {
  type: "assistant_thinking_delta";
  delta: string;
}

export interface AgentPlanCreatedEvent extends AgentBaseServerEvent {
  type: "plan_created";
  plan: GenerationPlan;
}

export interface AgentPlanUpdatedEvent extends AgentBaseServerEvent {
  type: "plan_updated";
  plan: GenerationPlan;
}

export interface AgentJobStartedEvent extends AgentBaseServerEvent {
  type: "job_started";
  planId: string;
  jobId: string;
}

export interface AgentJobCompletedEvent extends AgentBaseServerEvent {
  type: "job_completed";
  planId: string;
  jobId: string;
  outputs?: GenerationOutput[];
  record?: GenerationRecord;
}

export interface AgentJobFailedEvent extends AgentBaseServerEvent {
  type: "job_failed";
  planId: string;
  jobId: string;
  error: string;
}

export interface AgentJobBlockedEvent extends AgentBaseServerEvent {
  type: "job_blocked";
  planId: string;
  jobId: string;
  reason: string;
}

export interface AgentAssetPreviewEvent extends AgentBaseServerEvent {
  type: "asset_preview";
  planId: string;
  jobId: string;
  outputId: string;
  assetId: string;
  url: string;
  asset: GeneratedAsset;
  shapeId?: string;
}

export interface AgentRunCancelledEvent extends AgentBaseServerEvent {
  type: "run_cancelled";
  reason: string;
  alreadyCancelled: boolean;
}

export interface AgentRunDoneEvent extends AgentBaseServerEvent {
  type: "run_done";
  status: "succeeded" | "failed" | "cancelled";
}

export type AgentServerEvent =
  | AgentConnectedEvent
  | AgentPongEvent
  | AgentErrorEvent
  | AgentAssistantDeltaEvent
  | AgentAssistantThinkingDeltaEvent
  | AgentPlanCreatedEvent
  | AgentPlanUpdatedEvent
  | AgentJobStartedEvent
  | AgentJobCompletedEvent
  | AgentJobFailedEvent
  | AgentJobBlockedEvent
  | AgentAssetPreviewEvent
  | AgentRunCancelledEvent
  | AgentRunDoneEvent;
