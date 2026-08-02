import type { NormalizedInboundMessage, OutboundMessageResult } from "@42day/types";
import { createSupabaseRestClient } from "../../lib/supabase-rest";
import type { ApiBindings } from "../../lib/bindings";

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

export async function logOutboundTextMessage(input: {
  env: ApiBindings;
  schemaName: string;
  conversationId: string;
  text: string;
  result: OutboundMessageResult;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await logOutboundMessage({
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
  }).catch(() => []);

  return rows.map((row) => ({
    id: row.id,
    direction: row.direction,
    messageType: row.message_type,
    text: row.text ?? undefined,
    createdAt: row.created_at,
  }));
}

export async function logOutboundImageMessage(input: {
  env: ApiBindings;
  schemaName: string;
  conversationId: string;
  caption?: string;
  result: OutboundMessageResult;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await logOutboundMessage({
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
}): Promise<void> {
  const client = createSupabaseRestClient(input.env);

  await client.insert({
    schema: input.schemaName,
    table: "messages",
    rows: {
      conversation_id: input.conversationId,
      direction: "outbound",
      provider: "whatsapp_cloud",
      provider_message_id: input.result.providerMessageId,
      message_type: input.messageType,
      text: input.text,
      payload: appendInternalPayload(input.result.raw, input.metadata),
      status: input.result.ok
        ? input.result.providerMessageId ? "sent" : "send_attempted"
        : "failed",
    },
  });
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
