import { eq } from "drizzle-orm";
import type { AgentLlmConfigView, MaskedSecret, SaveAgentLlmConfigRequest } from "../contracts.js";
import { db } from "../../infrastructure/database.js";
import { agentLlmConfigs } from "../../infrastructure/schema.js";

const ACTIVE_AGENT_LLM_CONFIG_ID = "active";
export const DEFAULT_AGENT_LLM_TIMEOUT_MS = 60000;

type AgentLlmConfigRow = typeof agentLlmConfigs.$inferSelect;

export interface UsableAgentLlmConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  timeoutMs: number;
  supportsVision: boolean;
}

export function getAgentLlmConfig(): AgentLlmConfigView {
  return toAgentLlmConfigView(getAgentLlmConfigRow());
}

export function getUsableAgentLlmConfig(): UsableAgentLlmConfig | undefined {
  const row = getAgentLlmConfigRow();
  const apiKey = trimToUndefined(row?.apiKey);
  const model = trimToUndefined(row?.model);
  const timeoutMs = validTimeoutMs(row?.timeoutMs);

  if (!apiKey || !model || !timeoutMs) {
    return undefined;
  }

  return {
    apiKey,
    baseUrl: trimToUndefined(row?.baseUrl),
    model,
    timeoutMs,
    supportsVision: row?.supportsVision === 1
  };
}

export function saveAgentLlmConfig(input: SaveAgentLlmConfigRequest): AgentLlmConfigView {
  const now = new Date().toISOString();
  const existing = getAgentLlmConfigRow();
  const apiKey = resolveApiKeyForSave(input, existing);
  const baseUrl = input.baseUrl.trim();
  const model = requiredTrimmedString(input.model, "Agent LLM model");
  const timeoutMs = requiredPositiveInteger(input.timeoutMs, "Agent LLM timeout");

  if (!apiKey) {
    throw new Error("Agent LLM API key is required.");
  }

  const row: AgentLlmConfigRow = {
    id: ACTIVE_AGENT_LLM_CONFIG_ID,
    apiKey,
    baseUrl,
    model,
    timeoutMs,
    supportsVision: input.supportsVision ? 1 : 0,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  db.insert(agentLlmConfigs)
    .values(row)
    .onConflictDoUpdate({
      target: agentLlmConfigs.id,
      set: {
        apiKey: row.apiKey,
        baseUrl: row.baseUrl,
        model: row.model,
        timeoutMs: row.timeoutMs,
        supportsVision: row.supportsVision,
        updatedAt: row.updatedAt
      }
    })
    .run();

  return getAgentLlmConfig();
}

function getAgentLlmConfigRow(): AgentLlmConfigRow | undefined {
  return db.select().from(agentLlmConfigs).where(eq(agentLlmConfigs.id, ACTIVE_AGENT_LLM_CONFIG_ID)).get();
}

function toAgentLlmConfigView(row: AgentLlmConfigRow | undefined): AgentLlmConfigView {
  const timeoutMs = validTimeoutMs(row?.timeoutMs) ?? DEFAULT_AGENT_LLM_TIMEOUT_MS;
  const apiKey = trimToUndefined(row?.apiKey);
  const model = row?.model?.trim() ?? "";

  return {
    configured: Boolean(apiKey && model),
    apiKey: maskedSecret(apiKey),
    baseUrl: row?.baseUrl?.trim() ?? "",
    model,
    timeoutMs,
    supportsVision: row?.supportsVision === 1,
    createdAt: row?.createdAt ?? "",
    updatedAt: row?.updatedAt ?? ""
  };
}

function resolveApiKeyForSave(
  input: SaveAgentLlmConfigRequest,
  existing: AgentLlmConfigRow | undefined
): string | null {
  if (typeof input.apiKey === "string") {
    const trimmed = input.apiKey.trim();
    if (trimmed) {
      return trimmed;
    }

    return input.preserveApiKey === true ? (trimToUndefined(existing?.apiKey) ?? null) : null;
  }

  if (input.preserveApiKey === true) {
    return trimToUndefined(existing?.apiKey) ?? null;
  }

  return trimToUndefined(existing?.apiKey) ?? null;
}

function requiredTrimmedString(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

function requiredPositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return value;
}

function maskedSecret(value: string | null | undefined): MaskedSecret {
  const trimmed = trimToUndefined(value);
  return {
    hasSecret: Boolean(trimmed),
    value: trimmed ? maskSecret(trimmed) : undefined
  };
}

function maskSecret(value: string): string {
  if (value.length <= 8) {
    return "*".repeat(value.length);
  }

  return `${value.slice(0, 4)}${"*".repeat(Math.min(8, Math.max(4, value.length - 8)))}${value.slice(-4)}`;
}

function trimToUndefined(value: string | null | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function validTimeoutMs(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
