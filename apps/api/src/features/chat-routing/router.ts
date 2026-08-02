import { normalizeText } from "../../modules/message-router/message-normalizer";
import { detectSignals } from "../../modules/message-router/signal-detector";
import { classifyDeliveryAddressText } from "../delivery-coverage/address-text";
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
import { resolveEntryFlowAction } from "./entry-flow";
import { handleCustomerOrderStatus } from "./order-status";
import { buildMenuText, buildWelcomeMenuText } from "../menu/service";
import { isActiveOrderState, loadCurrentMenu } from "./shared/helpers";
import { logRoutingDiagnostic, markRoutingDecision } from "./shared/tracing";
import {
  tryHandleBillingReuseConfirmation,
  tryHandleElectronicBillingInfo,
  tryHandleNormalBillingInfo,
  tryHandlePaymentMethod,
  tryHandleDeliveryAddress,
} from "./checkout";
import { tryHandlePendingProductConfiguration } from "./guided/product-configuration";
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

  const signals = detectSignals({
    message: input.message,
    state: input.conversation.state,
  });

  // Only explicit, non-mutating controls bypass semantic interpretation.
  // A first natural-language order must always reach the semantic planner.
  const entryAction = resolveEntryFlowAction(signals);
  if (entryAction === "handoff") {
    markRoutingDecision(input, "manual_handoff", "explicit_human_request");
    await moveToManual(input, {
      type: "support_requested",
      manualReason: "explicit_human_request",
      title: "Cliente solicita atención humana",
      description: "El cliente pidió hablar con una persona.",
      responseText: "Claro, voy a ponerte en contacto con alguien del restaurante para que te ayude.",
    });
    return;
  }

  if (signals.wantsOrderStatus) {
    markRoutingDecision(input, "order_status", "explicit_order_status_request");
    await handleCustomerOrderStatus(input);
    return;
  }

  if (entryAction === "show_menu") {
    markRoutingDecision(input, "show_menu", signals.isGreeting ? "greeting" : "explicit_menu_request");
    // "Hola" or "menú" must never pretend that a new order started while a
    // checkout is still waiting for a required answer. The old behavior showed
    // the welcome menu but retained the billing/payment state, so the next
    // product message was incorrectly routed back to the previous checkout.
    if (isActiveOrderState(input.conversation.state)) {
      const resumePrompt = [
        "Tienes un pedido en curso.",
        buildClarificationPrompt(input.conversation.state),
        'Si prefieres empezar de nuevo, escribe "cancelar".',
      ].join(" ");

      if (signals.isGreeting && !signals.wantsMenu) {
        await sendAndLogText(input, resumePrompt);
        return;
      }

      const menu = await loadCurrentMenu(input);
      await sendAndLogText(input, [buildMenuText(menu), resumePrompt].join("\n\n"));
      return;
    }

    const menu = await loadCurrentMenu(input);
    await sendAndLogText(input, buildWelcomeMenuText(menu, input.tenant.name));
    return;
  }

  if (input.conversation.state === "awaiting_transfer_proof") {
    markRoutingDecision(input, "transfer_proof", "conversation_awaiting_transfer_proof");
    const handledTransferProof = await tryHandleTransferProofBranch(input);
    if (handledTransferProof) {
      return;
    }
  }

  // Payment and pending composite-product answers have an exact local grammar
  // (for example, "transferencia" or "1 y 2"). Handle them before asking the
  // semantic model so a valid answer cannot be lost to a low-confidence plan.
  if (input.conversation.state === "awaiting_payment_method") {
    markRoutingDecision(input, "payment_method", "conversation_awaiting_payment_method");
    const handledPaymentMethod = await tryHandlePaymentMethod(input, signals);
    if (handledPaymentMethod) {
      return;
    }
  }

  // Billing answers are structured checkout data, not an order-planning task.
  // Resolve them before the semantic fallback so a valid full name never gets
  // discarded because an LLM plan was low confidence or unavailable.
  if (input.conversation.state === "awaiting_billing_reuse_confirmation") {
    markRoutingDecision(input, "billing_reuse", "conversation_awaiting_billing_reuse");
    const handledBillingReuse = await tryHandleBillingReuseConfirmation(input, {
      confirmation: signals.confirmation,
      wantsElectronicBilling: signals.wantsElectronicBilling,
      billingDataChanged: signals.billingDataChanged,
    });
    if (handledBillingReuse) {
      return;
    }
  }

  if (input.conversation.state === "awaiting_normal_billing_info") {
    markRoutingDecision(input, "normal_billing", "conversation_awaiting_normal_billing");
    const handledNormalBilling = await tryHandleNormalBillingInfo(input, {
      wantsElectronicBilling: signals.wantsElectronicBilling,
    });
    if (handledNormalBilling) {
      return;
    }
  }

  if (input.conversation.state === "awaiting_electronic_billing_info") {
    markRoutingDecision(input, "electronic_billing", "conversation_awaiting_electronic_billing");
    const handledElectronicBilling = await tryHandleElectronicBillingInfo(input);
    if (handledElectronicBilling) {
      return;
    }
  }

  if (input.conversation.state === "awaiting_product_configuration") {
    markRoutingDecision(input, "product_configuration", "conversation_awaiting_product_configuration");
    const handledConfiguration = await tryHandlePendingProductConfiguration(input, { signals });
    if (handledConfiguration) {
      return;
    }
  }

  markRoutingDecision(input, "semantic_order", "natural_language_requires_semantic_plan");
  if (await trySemanticFallback(input)) {
    return;
  }

  if (
    input.conversation.state === "awaiting_address" ||
    (input.conversation.state === "awaiting_confirmation" && input.message.type === "location")
  ) {
    const addressKind = classifyDeliveryAddressText(normalizedText);
    markRoutingDecision(input, "delivery_address", "semantic_plan_did_not_handle_address");
    const handledAddress = await tryHandleDeliveryAddress(input, {
      looksLikeAddress: input.message.type === "location" || addressKind === "structured_address",
      cannotShareLocation: addressKind === "location_limitation",
      normalizedText,
    });
    if (handledAddress) {
      return;
    }
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
