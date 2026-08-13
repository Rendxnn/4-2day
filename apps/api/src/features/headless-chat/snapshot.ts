import type { Conversation } from "@42day/types";
import { createSupabaseRestClient } from "../../lib/supabase-rest.ts";
import type { ApiBindings } from "../../lib/bindings.ts";
import type { SafeSnapshot } from "./result";

export function createConversationSnapshot(conversation: Conversation, now = new Date()): SafeSnapshot {
  const expiresAt = conversation.expiresAt ? Date.parse(conversation.expiresAt) : Number.NaN;
  return {
    conversation: {
      id: conversation.id,
      state: conversation.state,
      automation: conversation.automationEnabled ? "enabled" : "manual",
      expiry: Number.isFinite(expiresAt)
        ? expiresAt > now.getTime() ? "active" : "expired"
        : "unknown",
    },
    draft: null,
    order: null,
  };
}

/**
 * Load only the safe, aggregate state needed by the headless envelope. This
 * deliberately excludes line names, addresses, billing and customer data.
 */
export async function loadHeadlessSnapshot(input: {
  env: ApiBindings;
  schemaName: string;
  conversation: Conversation;
  now?: Date;
}): Promise<SafeSnapshot> {
  const base = createConversationSnapshot(input.conversation, input.now);
  const client = createSupabaseRestClient(input.env);
  const draftRows = await client.select<{
    id: string;
    status: string;
    subtotal: number;
    delivery_fee: number;
    total: number;
    fulfillment_type?: string | null;
    payment_method?: string | null;
    validation_errors?: unknown;
  }>({
    schema: input.schemaName,
    table: "draft_orders",
    query: {
      select: "id,status,subtotal,delivery_fee,total,fulfillment_type,payment_method,validation_errors",
      ...(input.conversation.currentDraftOrderId
        ? { id: `eq.${input.conversation.currentDraftOrderId}` }
        : { conversation_id: `eq.${input.conversation.id}`, order: "updated_at.desc", limit: "1" }),
    },
  });
  const draftRow = draftRows[0];
  const draftId = draftRow?.id;
  let orderId: string | undefined;
  let orderState: string | undefined;
  let orderTotal: number | undefined;

  const itemRows = draftId
    ? await client.select<{ id: string }>({
        schema: input.schemaName,
        table: "draft_order_items",
        query: { select: "id", draft_order_id: `eq.${draftId}` },
      })
    : [];

  if (draftId) {
    const [order] = await client.select<{ id: string; status: string; total: number }>({
      schema: input.schemaName,
      table: "orders",
      query: {
        select: "id,status,total",
        draft_order_id: `eq.${draftId}`,
        order: "created_at.desc",
        limit: "1",
      },
    });
    orderId = order?.id;
    orderState = order?.status;
    orderTotal = typeof order?.total === "number" ? order.total : undefined;
  }

  return {
    ...base,
    draft: draftRow
      ? {
          id: draftRow.id,
          state: draftRow.status,
          itemCount: itemRows.length,
          subtotal: draftRow.subtotal,
          deliveryFee: draftRow.delivery_fee,
          total: draftRow.total,
          fulfillment: draftRow.fulfillment_type ?? null,
          payment: draftRow.payment_method ?? null,
          requiredFieldsComplete: !Array.isArray(draftRow.validation_errors) || draftRow.validation_errors.length === 0,
        }
      : null,
    order: orderId && orderState && orderTotal !== undefined
      ? { id: orderId, state: orderState, total: orderTotal }
      : null,
  };
}
