import type { NormalizedInboundMessage, OutboundMessageResult } from "@42day/types";
import { createSupabaseRestClient } from "../../lib/supabase-rest";
import type { ApiBindings } from "../../lib/bindings";
import type { CapturedResponse } from "../../features/chat-routing/ports";

type MessageLogRow = {
  id: string;
};

type ConversationMessageRow = {
  id: string;
  direction: "inbound" | "outbound";
  message_type: string;
  text?: string | null;
  created_at: string;
};

export async function logInboundMessage(input: {
  env: ApiBindings;
  schemaName: string;
  conversationId: string;
  message: NormalizedInboundMessage;
}): Promise<{ id: string }> {
  const client = createSupabaseRestClient(input.env);

  const [logged] = await client.insertReturning<MessageLogRow>({
    schema: input.schemaName,
    table: "messages",
    rows: {
      conversation_id: input.conversationId,
      direction: "inbound",
      provider: input.message.provider,
      provider_message_id: input.message.providerMessageId,
      message_type: input.message.type,
      text: input.message.text,
      payload: input.message.raw,
      status: "logged",
    },
  });

  if (!logged) {
    throw new Error("message_log.inbound_insert_failed");
  }

  return logged;
}

export async function checkpointNormalizedInbound(input: {
  env: ApiBindings;
  schemaName: string;
  messageId: string;
  manifest: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  return createSupabaseRestClient(input.env).rpc<Record<string, unknown>>({
    schema: "control",
    functionName: "claim_normalized_inbound",
    args: {
      p_schema_name: input.schemaName,
      p_message_id: input.messageId,
      p_manifest: input.manifest,
    },
  });
}

export async function finalizeNormalizedInbound(input: {
  env: ApiBindings;
  schemaName: string;
  messageId: string;
  postconditions: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  return createSupabaseRestClient(input.env).rpc<Record<string, unknown>>({
    schema: "control",
    functionName: "finalize_normalized_inbound",
    args: {
      p_schema_name: input.schemaName,
      p_message_id: input.messageId,
      p_postconditions: input.postconditions,
    },
  });
}

export async function logOutboundTextMessage(input: {
  env: ApiBindings;
  schemaName: string;
  conversationId: string;
  text: string;
  result: OutboundMessageResult;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  return logOutboundMessage({
    env: input.env,
    schemaName: input.schemaName,
    conversationId: input.conversationId,
    messageType: "text",
    text: input.text,
    result: input.result,
    metadata: input.metadata,
  });
}

export async function loadRecentConversationMessages(input: {
  env: ApiBindings;
  schemaName: string;
  conversationId: string;
  limit?: number;
  direction?: "inbound" | "outbound";
}): Promise<Array<{
  id: string;
  direction: "inbound" | "outbound";
  messageType: string;
  text?: string;
  createdAt: string;
}>> {
  const client = createSupabaseRestClient(input.env);
  const query: Record<string, string> = {
    select: "id,direction,message_type,text,created_at",
    conversation_id: `eq.${input.conversationId}`,
    order: "created_at.desc",
    limit: String(input.limit ?? 10),
  };

  if (input.direction) {
    query.direction = `eq.${input.direction}`;
  }

  const rows = await client.select<ConversationMessageRow>({
    schema: input.schemaName,
    table: "messages",
    query,
  });

  return rows.map((row) => ({
    id: row.id,
    direction: row.direction,
    messageType: row.message_type,
    text: row.text ?? undefined,
    createdAt: row.created_at,
  }));
}

export async function loadManualResumeCapturedResponses(input: {
  env: ApiBindings;
  schemaName: string;
  conversationId: string;
}): Promise<CapturedResponse[]> {
  const rows = await createSupabaseRestClient(input.env).select<{
    payload: unknown;
  }>({
    schema: input.schemaName,
    table: "messages",
    query: {
      select: "payload",
      conversation_id: `eq.${input.conversationId}`,
      direction: "eq.outbound",
      provider: "eq.headless",
      order: "created_at.asc,id.asc",
    },
  });
  return rows.flatMap((row) => {
    if (!isRecord(row.payload) || !isRecord(row.payload.internal) || !isRecord(row.payload.internal.capture)) return [];
    const capture = row.payload.internal.capture;
    return capture.captureContext === "manual_resume" && typeof capture.delivery === "string"
      ? [capture as unknown as CapturedResponse]
      : [];
  });
}

export async function logOutboundImageMessage(input: {
  env: ApiBindings;
  schemaName: string;
  conversationId: string;
  caption?: string;
  result: OutboundMessageResult;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  return logOutboundMessage({
    env: input.env,
    schemaName: input.schemaName,
    conversationId: input.conversationId,
    messageType: "image",
    text: input.caption,
    result: input.result,
    metadata: input.metadata,
  });
}

async function logOutboundMessage(input: {
  env: ApiBindings;
  schemaName: string;
  conversationId: string;
  messageType: "text" | "image";
  text?: string;
  result: OutboundMessageResult;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const client = createSupabaseRestClient(input.env);

  const [logged] = await client.insertReturning<{ id: string }>({
    schema: input.schemaName,
    table: "messages",
    rows: {
      conversation_id: input.conversationId,
      direction: "outbound",
      provider: resolveOutboundProvider(input.result, input.metadata),
      provider_message_id: input.result.providerMessageId ?? null,
      message_type: input.messageType,
      text: input.text,
      payload: appendInternalPayload(input.result.raw, input.metadata),
      status: input.result.ok
        ? resolveOutboundStatus(input.result, input.metadata)
        : "failed",
    },
  });
  if (!logged?.id) throw new Error("message_log.outbound_insert_failed");
  return logged.id;
}

function resolveOutboundProvider(_result: OutboundMessageResult, metadata: Record<string, unknown> | undefined): string {
  return metadata?.provider === "headless" ? "headless" : "whatsapp_cloud";
}

function resolveOutboundStatus(result: OutboundMessageResult, metadata: Record<string, unknown> | undefined): string {
  if (metadata?.deliveryStatus === "captured") {
    return "captured";
  }

  return result.providerMessageId ? "sent" : "send_attempted";
}

function appendInternalPayload(raw: unknown, metadata: Record<string, unknown> | undefined): unknown {
  if (!metadata) {
    return raw;
  }

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return {
      ...raw,
      internal: metadata,
    };
  }

  return {
    raw,
    internal: metadata,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
