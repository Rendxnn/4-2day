import { getConversationExpiration, isConversationExpired } from "@42day/core";
import type { Conversation, ConversationContext, ConversationState } from "@42day/types";
import type { ApiBindings } from "../../lib/bindings";
import { createSupabaseRestClient } from "../../lib/supabase-rest";
import { mapConversationRow } from "./mappers";
import {
  expireConversation,
  insertConversationRow,
  selectConversationById,
  selectRecentConversations,
  updateConversationRow,
} from "./repository";
import { createHeadlessCapture } from "../chat-routing/outbound/capture";
import { processNormalizedChatTurn } from "../chat-routing/process-normalized-chat-turn";
import type { NormalizedInboundMessage, Tenant } from "@42day/types";
import type { SemanticGenerationPort } from "../chat-routing/ports";

export function createNewConversation(input: {
  id: string;
  customerId: string;
  now?: Date;
}): Conversation {
  const now = input.now ?? new Date();

  return {
    id: input.id,
    customerId: input.customerId,
    channel: "whatsapp",
    state: "awaiting_mode_selection",
    automationEnabled: true,
    context: {},
    clarificationAttempts: 0,
    expiresAt: getConversationExpiration(now).toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function conversationNeedsExpiration(conversation: Conversation, now = new Date()): boolean {
  return isConversationExpired(conversation.expiresAt, now);
}

export async function touchConversationForInbound(input: {
  env: ApiBindings;
  schemaName: string;
  conversation: Conversation;
  now?: Date;
}): Promise<Conversation> {
  const now = input.now ?? new Date();
  return mapConversationRow(await updateConversationRow({
    env: input.env,
    schemaName: input.schemaName,
    conversationId: input.conversation.id,
    patch: {
      last_inbound_at: now.toISOString(),
      expires_at: getConversationExpiration(now).toISOString(),
      updated_at: now.toISOString(),
    },
  }));
}

export async function loadOrCreateActiveConversation(input: {
  env: ApiBindings;
  schemaName: string;
  customerId: string;
  now?: Date;
}): Promise<Conversation> {
  const now = input.now ?? new Date();
  const rows = await selectRecentConversations({
    env: input.env,
    schemaName: input.schemaName,
    customerId: input.customerId,
  });

  const reusable = rows
    .map(mapConversationRow)
    .find((conversation) => !conversationNeedsExpiration(conversation, now) && !["completed", "expired"].includes(conversation.state));

  if (reusable) {
    const expiresAt = getConversationExpiration(now).toISOString();

    await updateConversationRow({
      env: input.env,
      schemaName: input.schemaName,
      conversationId: reusable.id,
      patch: {
        last_inbound_at: now.toISOString(),
        expires_at: expiresAt,
        updated_at: now.toISOString(),
      },
    });

    return {
      ...reusable,
      lastInboundAt: now.toISOString(),
      expiresAt,
      updatedAt: now.toISOString(),
    };
  }

  for (const row of rows) {
    const conversation = mapConversationRow(row);
    if (conversationNeedsExpiration(conversation, now) && conversation.state !== "expired") {
      await expireConversation({
        env: input.env,
        schemaName: input.schemaName,
        conversationId: conversation.id,
        nowIso: now.toISOString(),
      });
    }
  }

  const expiresAt = getConversationExpiration(now).toISOString();
  const created = await insertConversationRow({
    env: input.env,
    schemaName: input.schemaName,
    row: {
      customer_id: input.customerId,
      channel: "whatsapp",
      state: "awaiting_mode_selection",
      context: {},
      clarification_attempts: 0,
      last_inbound_at: now.toISOString(),
      expires_at: expiresAt,
    },
  });

  return mapConversationRow(created);
}

export async function updateConversationState(input: {
  env: ApiBindings;
  schemaName: string;
  conversationId: string;
  state: ConversationState;
  manualReason?: string | null;
  context?: ConversationContext;
  resetClarificationAttempts?: boolean;
}): Promise<Conversation> {
  const now = new Date().toISOString();
  return mapConversationRow(
    await updateConversationRow({
      env: input.env,
      schemaName: input.schemaName,
      conversationId: input.conversationId,
      patch: {
      state: input.state,
      ...(input.manualReason !== undefined ? { manual_reason: input.manualReason } : {}),
      ...(input.context !== undefined ? { context: input.context } : {}),
      ...(input.resetClarificationAttempts ? { clarification_attempts: 0 } : {}),
      updated_at: now,
      },
    }),
  );
}

/**
 * Finishes the workflow that belonged to a cancelled order without deleting
 * its audit trail. The next inbound WhatsApp message will therefore create a
 * brand-new conversation and draft instead of continuing the cancelled flow.
 */
export async function completeConversationAfterOrderCancellation(input: {
  env: ApiBindings;
  schemaName: string;
  conversationId: string;
}): Promise<Conversation> {
  return completeConversationAfterTerminalOrder({
    ...input,
    reason: "order_cancelled",
  });
}

/**
 * Closes the workflow attached to a terminal order and restores automation.
 * A later inbound message from the same customer starts a fresh conversation.
 */
export async function completeConversationAfterTerminalOrder(input: {
  env: ApiBindings;
  schemaName: string;
  conversationId: string;
  reason: "order_cancelled" | "order_delivered";
}): Promise<Conversation> {
  const now = new Date().toISOString();

  return mapConversationRow(
    await updateConversationRow({
      env: input.env,
      schemaName: input.schemaName,
      conversationId: input.conversationId,
      patch: {
        state: "completed",
        context: {},
        clarification_attempts: 0,
        current_draft_order_id: null,
        manual_reason: null,
        automation_enabled: true,
        automation_resume_state: null,
        automation_changed_at: now,
        automation_changed_by: null,
        automation_change_reason: input.reason,
        updated_at: now,
      },
    }),
  );
}

export async function pauseConversationAutomation(input: {
  env: ApiBindings;
  schemaName: string;
  conversation: Conversation;
  manualReason: string;
  changedBy?: string;
}): Promise<Conversation> {
  const now = new Date().toISOString();
  const resumeState = input.conversation.state === "manual"
    ? (input.conversation.automationResumeState ?? "awaiting_mode_selection")
    : input.conversation.state;

  return mapConversationRow(await updateConversationRow({
    env: input.env,
    schemaName: input.schemaName,
    conversationId: input.conversation.id,
    patch: {
      state: "manual",
      manual_reason: input.manualReason,
      automation_enabled: false,
      automation_resume_state: resumeState,
      automation_changed_at: now,
      automation_changed_by: input.changedBy ?? null,
      automation_change_reason: input.manualReason,
      updated_at: now,
    },
  }));
}

export async function changeConversationAutomation(input: {
  env: ApiBindings;
  schemaName: string;
  conversationId: string;
  enabled: boolean;
  expectedUpdatedAt: string;
  changedBy: string;
  /** Internal test seam; dashboard and production callers never provide it. */
  semanticGeneration?: SemanticGenerationPort;
}): Promise<Conversation> {
  const row = await createSupabaseRestClient(input.env).rpc<Record<string, unknown>>({
    schema: input.schemaName,
    functionName: "change_conversation_automation",
    args: {
      p_conversation_id: input.conversationId,
      p_enabled: input.enabled,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_changed_by: input.changedBy,
    },
  });
  const conversation = mapConversationRow(row as Parameters<typeof mapConversationRow>[0]);
  if (input.enabled) {
    await processPendingHeadlessInbound({ ...input, conversation });
  }
  return conversation;
}

async function processPendingHeadlessInbound(input: {
  env: ApiBindings;
  schemaName: string;
  conversationId: string;
  enabled: boolean;
  expectedUpdatedAt: string;
  changedBy: string;
  conversation: Conversation;
  semanticGeneration?: SemanticGenerationPort;
}): Promise<void> {
  const client = createSupabaseRestClient(input.env);
  const claim = await client.rpc<{
    status: "claimed" | "none";
    id?: string;
    provider_message_id?: string | null;
    message_type?: string;
    text?: string | null;
  }>({
    schema: "control",
    functionName: "claim_pending_headless_inbound",
    args: { p_schema_name: input.schemaName, p_conversation_id: input.conversationId },
  });
  if (claim.status !== "claimed" || !claim.id || !claim.text) return;

  const tenant = await resolveTenantForConversation(input.env, input.schemaName);
  const message: NormalizedInboundMessage = {
    provider: "headless",
    providerMessageId: claim.provider_message_id ?? `headless-resume:${claim.id}`,
    phoneNumberId: "headless",
    from: "headless-resume",
    type: claim.message_type === "text" ? "text" : "unknown",
    text: claim.text,
    raw: { source: "headless", type: claim.message_type },
  };
  const headlessEffectIds: string[] = [];
  await processNormalizedChatTurn({
    env: input.env,
    tenant,
    conversation: input.conversation,
    message,
    traceId: `headless-resume-${claim.id}`,
    loggedMessageId: claim.id,
    source: "headless",
    captureContext: "manual_resume",
    originatingTurnId: claim.provider_message_id ?? claim.id,
    delivery: createHeadlessCapture({ captureContext: "manual_resume", originatingTurnId: claim.provider_message_id ?? claim.id }),
    headlessEffectIds,
    semanticGeneration: input.semanticGeneration,
  });
}

async function resolveTenantForConversation(env: ApiBindings, schemaName: string): Promise<Tenant> {
  const [row] = await createSupabaseRestClient(env).select<{
    id: string;
    name: string;
    slug: string;
    schema_name: string;
    status: Tenant["status"];
    timezone: string;
    currency: string;
    automation_enabled: boolean;
  }>({
    schema: "control",
    table: "tenants",
    query: { select: "id,name,slug,schema_name,status,timezone,currency,automation_enabled", schema_name: `eq.${schemaName}`, limit: 1 },
  });
  if (!row) throw new Error("tenant.not_found");
  return { id: row.id, name: row.name, slug: row.slug, schemaName: row.schema_name, status: row.status, timezone: row.timezone, currency: row.currency, automationEnabled: row.automation_enabled };
}

export async function updateConversationContext(input: {
  env: ApiBindings;
  schemaName: string;
  conversationId: string;
  context: ConversationContext;
}): Promise<Conversation> {
  const current = await selectConversationById({
    env: input.env,
    schemaName: input.schemaName,
    conversationId: input.conversationId,
  });

  if (!current) {
    throw new Error("conversation.not_found");
  }

  return updateConversationState({
    env: input.env,
    schemaName: input.schemaName,
    conversationId: input.conversationId,
    state: current.state,
    manualReason: current.manual_reason,
    context: {
      ...(current.context ?? {}),
      ...input.context,
    },
  });
}

export async function incrementClarificationAttempts(input: {
  env: ApiBindings;
  schemaName: string;
  conversationId: string;
}): Promise<Conversation> {
  const current = await selectConversationById({
    env: input.env,
    schemaName: input.schemaName,
    conversationId: input.conversationId,
  });

  if (!current) {
    throw new Error("conversation.not_found");
  }

  return mapConversationRow(
    await updateConversationRow({
      env: input.env,
      schemaName: input.schemaName,
      conversationId: input.conversationId,
      patch: {
        clarification_attempts: (current.clarification_attempts ?? 0) + 1,
        updated_at: new Date().toISOString(),
      },
    }),
  );
}
