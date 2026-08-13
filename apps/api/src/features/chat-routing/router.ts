import { normalizeText } from "../../modules/message-router/message-normalizer";
import {
  buildClarificationPrompt,
  buildLocationCapturedForLaterMessage,
  buildRestaurantReviewPendingMessage,
} from "../../modules/message-router/response-composer";
import { sendAndLogText } from "./outbound/send";
import {
  handleTransferFallbackPaymentMethodClarification,
} from "./transfer/fallback";
import { handleTransferProofClarification, tryHandleTransferProof as tryHandleTransferProofBranch } from "./transfer/proof";
import { tryHandleSemanticOrder } from "./semantic/order";
import { handleClarification } from "./manual/handoff";
import { moveToManual } from "./manual/handoff";
import { loadCurrentMenu } from "./shared/helpers";
import { logRoutingDiagnostic, markRoutingDecision } from "./shared/tracing";
import type { RouteInboundMessageInput } from "./shared/types";
import { logEvent } from "../../lib/observability/logger.ts";
export type { RouteInboundMessageInput } from "./shared/types";

export async function routeInboundMessage(input: RouteInboundMessageInput): Promise<void> {
  input.routingTrace = {
    responseSource: "deterministic",
    responseReason: "route_started",
  };

  logRoutingDiagnostic(input, "chat_routing.message_received", {
    hasText: Boolean(input.message.text?.trim()),
    textLength: input.message.text?.trim().length ?? 0,
  });

  if (!input.tenant.automationEnabled) {
    logEvent("info", "tenant.automation_disabled", "La automatización del tenant está desactivada.", {
      environment: input.env.APP_ENV,
      traceId: input.traceId,
      tenantId: input.tenant.id,
      providerMessageId: input.message.providerMessageId,
    });
    return;
  }

  const normalizedText = normalizeText(input.message.text);

  logRoutingDiagnostic(input, "chat_routing.inbound_received", {
    normalizedTextLength: normalizedText.length,
  });

  if (!input.conversation.automationEnabled || input.conversation.state === "manual") {
    logEvent("info", "conversation.manual_auto_reply_skipped", "La conversación está en modo manual; no se enviará respuesta automática.", {
      environment: input.env.APP_ENV,
      traceId: input.traceId,
      tenantId: input.tenant.id,
      conversationId: input.conversation.id,
      providerMessageId: input.message.providerMessageId,
    });
    return;
  }

  markRoutingDecision(input, "semantic_order", "all_text_requires_semantic_plan");
  if (await trySemanticFallback(input)) {
    return;
  }

  if (input.message.type === "location" && input.message.location) {
    markRoutingDecision(input, "location_captured", "location_received_outside_address_step");
    await sendAndLogText(
      input,
      buildLocationCapturedForLaterMessage(),
    );
    return;
  }

  if (input.conversation.state === "awaiting_restaurant_confirmation") {
    markRoutingDecision(input, "restaurant_confirmation_wait", "conversation_awaiting_restaurant_confirmation");
    await sendAndLogText(input, buildRestaurantReviewPendingMessage());
    return;
  }

  if (input.conversation.state === "awaiting_transfer_proof") {
    markRoutingDecision(input, "transfer_proof_clarification", "transfer_proof_not_resolved");
    await handleTransferProofClarification(input);
    return;
  }

  if (input.conversation.state === "awaiting_transfer_fallback_payment_method") {
    markRoutingDecision(input, "transfer_fallback_clarification", "transfer_fallback_not_resolved");
    await handleTransferFallbackPaymentMethodClarification(input);
    return;
  }

  markRoutingDecision(input, "clarification", "validation_failed_repeatedly");
  await handleClarification(input, buildClarificationPrompt(input.conversation.state), "validation_failed_repeatedly");
}

async function trySemanticFallback(input: RouteInboundMessageInput): Promise<boolean> {
  if (!input.message.text?.trim()) {
    return false;
  }

  return tryHandleSemanticOrder(input);
}
