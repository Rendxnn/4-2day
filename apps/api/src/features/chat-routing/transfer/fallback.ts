import { createSupabaseRestClient } from "../../../lib/supabase-rest";
import {
  buildManualHandoffMessage,
  buildTransferFallbackCashConfirmedMessage,
  buildTransferFallbackPaymentPrompt,
} from "../../../modules/message-router/response-composer";
import { updateConversationStateForRoute } from "../shared/effects";
import { moveToManual } from "../manual/handoff";
import { handleClarification } from "../manual/handoff";
import { sendAndLogText } from "../outbound/send";
import type { RouteInboundMessageInput } from "../shared/types";

type DraftOrderCandidateRow = {
  id: string;
  conversation_id: string;
  updated_at: string;
};

type AcceptedTransferOrderRow = {
  id: string;
  draft_order_id?: string | null;
  payment_method: "cash" | "transfer";
  status: string;
  updated_at: string;
};

export async function tryHandleTransferFallbackPaymentMethod(
  input: RouteInboundMessageInput,
  signals: {
    paymentMethod?: "cash" | "transfer" | null;
    confirmation?: "yes" | "no" | "change" | null;
  },
): Promise<boolean> {
  if (signals.paymentMethod === "transfer") {
    await sendAndLogText(input, buildTransferFallbackPaymentPrompt());
    return true;
  }

  if (signals.paymentMethod === "cash" || signals.confirmation === "yes") {
    const order = await findAcceptedTransferOrderForConversation(input);
    if (!order) {
      await moveToManual(input, {
        type: "technical_error",
        manualReason: "transfer_fallback_order_not_found",
        title: "Orden transfer no encontrada",
        description: "La conversación quedó esperando respuesta para cambiar el pago a efectivo, pero no se encontró la orden aceptada correspondiente.",
        responseText: buildManualHandoffMessage(),
      });
      return true;
    }

    const now = new Date().toISOString();
    await Promise.all([
      createSupabaseRestClient(input.env).update({
        schema: input.tenant.schemaName,
        table: "orders",
        query: {
          id: `eq.${order.id}`,
        },
        values: {
          payment_method: "cash",
          updated_at: now,
        },
      }),
      createSupabaseRestClient(input.env).insert({
        schema: input.tenant.schemaName,
        table: "app_events",
        rows: {
          conversation_id: input.conversation.id,
          draft_order_id: order.draft_order_id ?? null,
          order_id: order.id,
          event_name: "order.payment_method_changed_to_cash",
          severity: "info",
          source: "chat_routing",
          metadata: {
            previousPaymentMethod: "transfer",
            nextPaymentMethod: "cash",
          },
        },
      }).catch(() => undefined),
    ]);

    await updateConversationStateForRoute(input, {
      state: "completed",
      resetClarificationAttempts: true,
    });

    await sendAndLogText(input, buildTransferFallbackCashConfirmedMessage());
    return true;
  }

  return false;
}

export async function handleTransferFallbackPaymentMethodClarification(input: RouteInboundMessageInput): Promise<void> {
  await handleClarification(input, buildTransferFallbackPaymentPrompt(), "transfer_fallback_payment_method_unresolved");
}

async function findAcceptedTransferOrderForConversation(input: RouteInboundMessageInput): Promise<AcceptedTransferOrderRow | undefined> {
  const client = createSupabaseRestClient(input.env);
  const candidateDraftIds = new Set<string>();

  if (input.conversation.currentDraftOrderId) {
    candidateDraftIds.add(input.conversation.currentDraftOrderId);
  }

  const draftOrders = await client.select<DraftOrderCandidateRow>({
    schema: input.tenant.schemaName,
    table: "draft_orders",
    query: {
      select: "id,conversation_id,updated_at",
      conversation_id: `eq.${input.conversation.id}`,
      order: "updated_at.desc",
      limit: 10,
    },
  }).catch(() => []);

  for (const draftOrder of draftOrders) {
    candidateDraftIds.add(draftOrder.id);
  }

  if (candidateDraftIds.size === 0) {
    return undefined;
  }

  const [order] = await client.select<AcceptedTransferOrderRow>({
    schema: input.tenant.schemaName,
    table: "orders",
    query: {
      select: "id,draft_order_id,payment_method,status,updated_at",
      draft_order_id: `in.(${Array.from(candidateDraftIds).join(",")})`,
      payment_method: "eq.transfer",
      status: "eq.accepted",
      order: "updated_at.desc",
      limit: 1,
    },
  });

  return order;
}
