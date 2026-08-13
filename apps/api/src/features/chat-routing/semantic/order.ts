import { calculateDraftTotals } from "@42day/core";
import type { DraftOrder, MenuItem, OrderLineItem, OrderLineItemOptionsSnapshot, OrderLineItemResolvedOption, TodayMenuPayload } from "@42day/types";
import { buildClarificationPrompt, buildElectronicBillingPrompt, buildFulfillmentPrompt, buildNormalBillingPrompt, buildOrderProgressSnapshot, buildOrderSummaryText, buildPaymentPrompt } from "../../../modules/message-router/response-composer";
import { loadRecentConversationMessages } from "../../../modules/message-log/message-log";
import { applySemanticDraftOperationPlan, loadActiveDraftOrder } from "../../draft-orders/service";
import { buildWelcomeMenuText, resolveMenuSelectionsFromText } from "../../menu/service";
import { getDeliveryCoverageSettings, hasValidatedDeliveryCoverage, validateDeliveryCoverageFromWrittenAddress } from "../../delivery-coverage/service";
import { segmentDeliveryAddress } from "../../delivery-coverage/address-text";
import { loadCustomerBillingProfiles } from "../../../modules/customer-billing-service/customer-billing-service";
import { applyBillingDefaults } from "../checkout/billing-helpers";
import { tryHandleBillingReuseConfirmation } from "../checkout/billing";
import { readPendingBillingContext } from "../checkout/billing-helpers";
import { tryHandleConfirmation } from "../checkout/confirmation";
import { tryHandleTransferFallbackPaymentMethod } from "../transfer/fallback";
import { moveToManual, handleClarification } from "../manual/handoff";
import { sendAndLogText } from "../outbound/send";
import { loadCurrentMenu } from "../shared/helpers";
import { handleCustomerOrderStatus } from "../order-status";
import { logRoutingDiagnostic, markLlmAttempt, markLlmOutcome } from "../shared/tracing";
import type { RouteInboundMessageInput } from "../shared/types";
import { buildOrderLineItemOptionsSnapshot, extractExplicitConfigurationOptionTexts, isExplicitConfigurationSkip, resolveProductConfiguration, shouldPersistConfigurationSnapshot } from "../../product-configurator/service";
import { persistPendingProductConfiguration, readPendingProductConfiguration } from "../guided/product-configuration";
import { cancelPendingCustomerReplacementOrder, getPendingCustomerReplacementOrder } from "../../orders/service";
import { completeConversationAfterOrderCancellation } from "../../conversations/service";
import { persistHumanInterventionAlert } from "../../../modules/handoff-service/handoff-service";
import { createSupabaseRestClient, SupabaseRestError } from "../../../lib/supabase-rest";
import { safeErrorSummary, sanitizeErrorDetail } from "../../../lib/observability/logger.ts";
import { SemanticOperationPlanInferenceError, allowedSemanticOperations, parseSemanticOperationPlan, semanticOperationPlanFailureDiagnostics, type SemanticBillingInput, type SemanticConfigurationSelection, type SemanticOperation, type SemanticOperationPlan } from "./operation-plan";
import { consolidateOrderLineItems } from "../../draft-orders/consolidation.ts";
import { hasExplicitFulfillmentEvidence, hasExplicitPaymentEvidence } from "./evidence.ts";
import { recordHeadlessEffect } from "../shared/effects";
import { buildPostconditionFingerprints, type ManifestExpectation } from "./execution-manifest.ts";

type DraftPatch = {
  fulfillmentType?: DraftOrder["fulfillmentType"];
  paymentMethod?: DraftOrder["paymentMethod"];
  deliveryAddress?: string | null;
  deliveryAddressDetails?: string | null;
  customerAddressText?: string | null;
  resolvedDeliveryAddress?: string | null;
  customerLatitude?: number | null;
  customerLongitude?: number | null;
  deliveryDistanceKm?: number | null;
  isInsideDeliveryCoverage?: boolean | null;
  coverageValidationMethod?: DraftOrder["coverageValidationMethod"] | null;
  coverageConfidence?: DraftOrder["coverageConfidence"] | null;
  coverageCheckedAt?: string | null;
};

type AddressCoverageOutcome = "inside" | "outside" | "outside_allowed" | "unresolved" | "provider_error";

type AddressResolution = {
  patch: DraftPatch;
  coverageOutcome: AddressCoverageOutcome;
  validationMethod?: DraftOrder["coverageValidationMethod"];
  confidence?: DraftOrder["coverageConfidence"];
};

type ValidatedPlan = {
  items: OrderLineItem[];
  patch: DraftPatch;
  billing?: NonNullable<DraftOrder["billing"]>;
  hasMutation: boolean;
  hasItemMutation: boolean;
  advancesCheckout: boolean;
  addressResolution?: AddressResolution;
};

type NextStep = {
  state: RouteInboundMessageInput["conversation"]["state"];
  context?: Record<string, unknown>;
  billingReuseLabel?: string;
  addressCoverageOutcome?: AddressCoverageOutcome;
};

export async function tryHandleSemanticOrder(input: RouteInboundMessageInput): Promise<boolean> {
  const menu = await loadCurrentMenu(input);
  const existingDraft = await loadActiveDraftOrder({
    env: input.env,
    schemaName: input.tenant.schemaName,
    conversation: input.conversation,
  });
  const [lastOutbound] = await loadRecentConversationMessages({
    env: input.env,
    schemaName: input.tenant.schemaName,
    conversationId: input.conversation.id,
    direction: "outbound",
    limit: 1,
  });
  const pendingAdjustment = input.conversation.state === "awaiting_order_adjustment"
    ? await getPendingCustomerReplacementOrder({
        env: input.env,
        schemaName: input.tenant.schemaName,
        conversationId: input.conversation.id,
        currentDraftOrderId: input.conversation.currentDraftOrderId,
      }).catch(() => undefined)
    : undefined;
  const pendingConfiguration = readPendingProductConfiguration(input.conversation);

  markLlmAttempt(input);
  let manifestCheckpointed = false;
  const checkpointBeforeEffect = async (plan: SemanticOperationPlan | null, expectation: ManifestExpectation = {}): Promise<void> => {
    if (manifestCheckpointed || !input.beforeFirstEffect) return;
    const operationTypes = plan?.operations.map((operation) => operation.type) ?? [];
    const canonicalIds = plan ? collectCanonicalIds(plan) : [];
    const preconditions = [`conversation.state:${input.conversation.state}`];
    const idempotencyKeys = input.message.providerMessageId ? [input.message.providerMessageId] : [];
    const postconditionKinds = operationTypes.length > 0
      ? ["conversation.state", "draft_order", "order", "outbound_messages"]
      : ["conversation.state", "outbound_messages"];
    const postconditionFingerprints = await buildPostconditionFingerprints({
      operationTypes,
      canonicalIds,
      idempotencyKeys,
      preconditions,
      postconditionKinds,
      expectation,
    });
    const digest = await digestManifest({ operationTypes, canonicalIds, preconditions, postconditionFingerprints });
    await input.beforeFirstEffect({
      version: 1,
      digest,
      operationTypes,
      canonicalIds,
      idempotencyKeys,
      preconditions,
      postconditionFingerprints,
    });
    manifestCheckpointed = true;
  };
  let parsed: SemanticOperationPlan;
  let providerId: "gemini" | "openrouter" | "test_double" = "gemini";
  try {
    const execution = await parseSemanticOperationPlan({
      env: input.env,
      tenantId: input.tenant.id,
      traceId: input.traceId,
      rawMessage: input.message.text ?? "",
      conversation: input.conversation,
      menu,
      draft: existingDraft,
      lastAssistantPrompt: lastOutbound?.text,
      allowedOperations: allowedSemanticOperations(input.conversation.state),
      pendingAdjustment: pendingAdjustment
        ? { unavailableMenuItemIds: pendingAdjustment.order.restaurantReviewMetadata?.unavailableItems?.map((item) => item.menuItemId).filter((id): id is string => Boolean(id)) ?? [] }
        : undefined,
      pendingConfiguration: pendingConfiguration
        ? {
            menuItemId: pendingConfiguration.menuItemId,
            quantity: pendingConfiguration.quantity,
            pendingOptionId: pendingConfiguration.pendingOptionId,
            configuration: toSemanticConfigurationSelections(pendingConfiguration.resolvedOptions),
            notes: pendingConfiguration.notes,
          }
        : undefined,
      generation: input.semanticGeneration,
    });
    parsed = execution.plan;
    parsed = reconcileMenuMentionsInPlan(parsed, menu, input.message.text ?? "", allowedSemanticOperations(input.conversation.state));
    providerId = execution.providerId;
    input.routingTrace = {
      ...(input.routingTrace ?? {}),
      llm: {
        ...(input.routingTrace?.llm ?? { attempted: true, used: false, outcome: "skipped_or_failed" as const }),
        operationTypes: parsed.operations.map((operation) => operation.type),
        model: execution.attempts.at(-1)?.model ?? input.routingTrace?.llm?.model,
      },
    };
    logRoutingDiagnostic(input, "semantic_operation_plan.completed", {
      provider: execution.providerId,
      fallbackFromProviderId: execution.fallbackFromProviderId,
      attempts: execution.attempts,
      confidence: parsed.confidence,
      operationTypes: parsed.operations.map((operation) => operation.type),
      operationCount: parsed.operations.length,
    });
  } catch (error) {
    const diagnostics = semanticOperationPlanFailureDiagnostics(error);
    const failedProvider = error instanceof SemanticOperationPlanInferenceError
      ? error.attempts.at(-1)?.provider ?? providerId
      : providerId;
    const failedModel = error instanceof SemanticOperationPlanInferenceError
      ? error.attempts.at(-1)?.model
      : undefined;
    logRoutingDiagnostic(input, "semantic_operation_plan.failed", {
      provider: failedProvider,
      reason: classifySemanticFailure(error),
      ...diagnostics,
      menuItemCount: menu.items.length,
      draftLineCount: existingDraft?.items.length ?? 0,
      allowedOperationCount: allowedSemanticOperations(input.conversation.state).length,
    });
    markLlmOutcome(input, {
      used: false,
      outcome: "skipped_or_failed",
      provider: failedProvider,
      model: failedModel,
      reason: "semantic_operation_plan_provider_failure",
      diagnostics,
    });
    await checkpointBeforeEffect(null);
    await handleSemanticProviderFailure(input, diagnostics);
    return true;
  }

  if (parsed.confidence < 0.55 || parsed.operations.length === 0) {
    markLlmOutcome(input, { used: false, outcome: parsed.confidence < 0.55 ? "low_confidence" : "unresolved", provider: providerId, reason: "semantic_operation_plan_empty_or_low_confidence" });
    await checkpointBeforeEffect(null);
    await handleClarification(input, buildClarificationPrompt(input.conversation.state), "semantic_operation_plan_unresolved");
    return true;
  }

  const specialValidation = await validateSpecialSemanticPlan(input, parsed, pendingAdjustment, existingDraft);
  if (specialValidation) {
    markLlmOutcome(input, { used: false, outcome: "unresolved", provider: providerId, reason: specialValidation.code });
    await checkpointBeforeEffect(null);
    await handleClarification(input, specialValidation.message, specialValidation.code);
    return true;
  }

  if (parsed.operations.some((operation) => operation.type === "request_human")) {
    markLlmOutcome(input, { used: true, outcome: "handled", provider: providerId, reason: "semantic_request_human" });
    await checkpointBeforeEffect(parsed, { conversationState: "manual", responseExpected: true });
    await moveToManual(input, {
      type: "support_requested",
      manualReason: "semantic_operation_requested_human",
      title: "Cliente solicita atención humana",
      description: "El cliente pidió hablar con una persona.",
      responseText: "Claro, voy a ponerte en contacto con alguien del restaurante para que te ayude.",
    });
    await recordHeadlessEffect(input, { type: "conversation_mutation", id: input.conversation.id, status: "updated" });
    return true;
  }

  if (parsed.operations.some((operation) => operation.type === "show_menu")) {
    markLlmOutcome(input, { used: true, outcome: "handled", provider: providerId, reason: "semantic_show_menu" });
    await checkpointBeforeEffect(parsed, { responseExpected: true });
    await sendAndLogText(input, [buildWelcomeMenuText(menu, input.tenant.name), existingDraft ? buildOrderProgressSnapshot(existingDraft) : ""].filter(Boolean).join("\n\n"));
    return true;
  }

  if (parsed.operations.some((operation) => operation.type === "get_order_status")) {
    if (parsed.operations.length !== 1) {
      await handleClarification(input, "Puedo consultar el estado o continuar con el pedido, pero no ambas cosas a la vez.", "semantic_status_mixed");
      return true;
    }
    markLlmOutcome(input, { used: true, outcome: "handled", provider: providerId, reason: "semantic_order_status" });
    await checkpointBeforeEffect(parsed, { responseExpected: true });
    await handleCustomerOrderStatus(input);
    return true;
  }

  const controlOperations = parsed.operations.filter((operation) => [
    "reuse_billing_profile",
    "change_billing",
    "switch_to_electronic_billing",
    "edit_order",
    "accept_cash_fallback",
    "keep_transfer",
  ].includes(operation.type));
  if (controlOperations.length > 0) {
    if (parsed.operations.length !== 1 || controlOperations.length !== 1) {
      markLlmOutcome(input, { used: false, outcome: "unresolved", provider: providerId, reason: "semantic_control_mixed" });
      await checkpointBeforeEffect(null);
      await handleClarification(input, "Primero resolvamos una sola decisión del pedido para continuar.", "semantic_control_mixed");
      return true;
    }
    markLlmOutcome(input, {
      used: true,
      outcome: "handled",
      provider: providerId,
      reason: `semantic_${controlOperations[0]!.type}`,
    });
    await checkpointBeforeEffect(parsed, buildSpecialManifestExpectation(parsed, existingDraft));
    const handled = await tryHandleSemanticControl(input, controlOperations[0]!);
    if (handled) await recordHeadlessEffect(input, { type: "conversation_mutation", id: input.conversation.id, status: "updated" });
    markLlmOutcome(input, {
      used: handled,
      outcome: handled ? "handled" : "unresolved",
      provider: providerId,
      reason: `semantic_${controlOperations[0]!.type}`,
    });
    return handled;
  }

  if (parsed.operations.some((operation) => operation.type === "confirm_order") && parsed.operations.length === 1) {
    markLlmOutcome(input, { used: true, outcome: "handled", provider: providerId, reason: "semantic_confirm_order" });
    await checkpointBeforeEffect(parsed, buildSpecialManifestExpectation(parsed, existingDraft));
    const handled = await tryHandleConfirmation(input, { confirmation: "yes" });
    markLlmOutcome(input, { used: handled, outcome: handled ? "handled" : "unresolved", provider: providerId, reason: "semantic_confirm_order" });
    return handled;
  }

  if (parsed.operations.some((operation) => operation.type === "cancel_order")) {
    if (input.conversation.state !== "awaiting_order_adjustment" || parsed.operations.length !== 1 || !pendingAdjustment) {
      markLlmOutcome(input, { used: false, outcome: "unresolved", provider: providerId, reason: "semantic_cancel_not_allowed" });
      await checkpointBeforeEffect(null);
      await handleClarification(input, "En este momento solo puedo cancelar el pedido que está pendiente por ajustar. Dime qué deseas cambiar o escribe asesor para recibir ayuda.", "semantic_cancel_not_allowed");
      return true;
    }
    await checkpointBeforeEffect(parsed, { conversationState: "completed", responseExpected: true });
    await cancelPendingCustomerReplacementOrder({
      env: input.env,
      schemaName: input.tenant.schemaName,
      conversationId: input.conversation.id,
      currentDraftOrderId: input.conversation.currentDraftOrderId,
    });
    await completeConversationAfterOrderCancellation({
      env: input.env,
      schemaName: input.tenant.schemaName,
      conversationId: input.conversation.id,
    });
    await recordHeadlessEffect(input, { type: "order_mutation", id: pendingAdjustment.order.id, status: "updated" });
    markLlmOutcome(input, { used: true, outcome: "handled", provider: providerId, reason: "semantic_cancel_order_adjustment" });
    await sendAndLogText(input, "Entendido. Ya cancelé ese pedido. Gracias por avisarme.");
    return true;
  }

  const validation = await validateOperationPlan(input, { menu, draft: existingDraft, plan: parsed, pendingAdjustment, pendingConfiguration });
  if (validation.kind === "pending_configuration") {
    markLlmOutcome(input, { used: true, outcome: "handled", provider: providerId, reason: "semantic_operation_pending_configuration" });
    await checkpointBeforeEffect(parsed, { responseExpected: true });
    await persistPendingProductConfiguration(input, validation.payload);
    await recordHeadlessEffect(input, { type: "conversation_mutation", id: input.conversation.id, status: "updated" });
    return true;
  }
  if (validation.kind === "invalid") {
    logRoutingDiagnostic(input, "semantic_operation_plan.rejected", { code: validation.code, operationTypes: parsed.operations.map((operation) => operation.type) });
    markLlmOutcome(input, { used: false, outcome: "unresolved", provider: providerId, reason: validation.code });
    await checkpointBeforeEffect(null);
    await handleClarification(input, validation.message, validation.code);
    return true;
  }

  if (!validation.value.hasMutation) {
    markLlmOutcome(input, { used: true, outcome: "handled", provider: providerId, reason: "semantic_continue_checkout" });
    const projected = projectDraft(existingDraft, validation.value, menu);
    const next = await resolveNextStep(input, projected, menu, {
      isAdjustment: false,
      hasItemMutation: false,
      advancesCheckout: true,
    });
    await checkpointBeforeEffect(parsed, {
      conversationState: next.state,
      draft: {
        id: projected.id || null,
        itemCount: validation.value.items.length,
        total: projected.total,
        fulfillment: projected.fulfillmentType ?? null,
        payment: projected.paymentMethod ?? null,
      },
      responseExpected: true,
    });
    if (existingDraft) {
      await sendOrderStepMessage(input, projected, menu, next);
    } else {
      await handleClarification(input, buildClarificationPrompt(input.conversation.state), "semantic_operation_no_mutation");
    }
    return true;
  }

  const projected = projectDraft(existingDraft, validation.value, menu);
  const next = await resolveNextStep(input, projected, menu, {
    isAdjustment: input.conversation.state === "awaiting_order_adjustment",
    hasItemMutation: validation.value.hasItemMutation,
    advancesCheckout: validation.value.advancesCheckout,
    addressResolution: validation.value.addressResolution,
  });
  let draft: DraftOrder;
  try {
    await checkpointBeforeEffect(parsed, {
      conversationState: next.state,
      draft: {
        id: projected.id || null,
        itemCount: projected.items.length,
        total: projected.total,
        fulfillment: projected.fulfillmentType ?? null,
        payment: projected.paymentMethod ?? null,
      },
      responseExpected: true,
    });
    draft = await applySemanticDraftOperationPlan({
      env: input.env,
      schemaName: input.tenant.schemaName,
      conversation: input.conversation,
      customerId: input.conversation.customerId,
      locationId: existingDraft?.locationId ?? menu.location?.id,
      draftOrderId: existingDraft?.id,
      expectedDraftUpdatedAt: existingDraft?.updatedAt,
      items: validation.value.items,
      patch: validation.value.patch,
      billing: validation.value.billing,
      nextState: next.state,
      context: contextAfterSemanticPlan(input, next.context, pendingConfiguration),
    });
  } catch (error) {
    const operationError = semanticOperationFailureDiagnostics(error);
    logRoutingDiagnostic(input, "semantic_operation_plan.transaction_failed", {
      reason: classifySemanticFailure(error),
      operationTypes: parsed.operations.map((operation) => operation.type),
      error: operationError,
      orderChanged: false,
    });
    markLlmOutcome(input, { used: false, outcome: "unresolved", provider: providerId, reason: "semantic_operation_transaction_failed" });
    await handleClarification(input, "Tu pedido no cambió porque detecté una actualización reciente. Revisemos el estado actual antes de continuar.", "semantic_operation_transaction_failed");
    return true;
  }
  await recordHeadlessEffect(input, { type: "draft_order_mutation", id: draft.id, status: "updated" });
  // The draft RPC also advances the conversation state atomically; expose
  // that second durable frontier so headless reconciliation can distinguish a
  // draft-only partial from a draft-plus-conversation partial.
  await recordHeadlessEffect(input, { type: "conversation_mutation", id: input.conversation.id, status: "updated" });
  logRoutingDiagnostic(input, "semantic_operation_plan.applied", { operationTypes: parsed.operations.map((operation) => operation.type), nextState: next.state, itemCount: draft.items.length, total: draft.total });
  markLlmOutcome(input, { used: true, outcome: "handled", provider: providerId, reason: "semantic_operation_plan_applied" });
  await sendOrderStepMessage(input, draft, menu, next);
  return true;
}

async function validateSpecialSemanticPlan(
  input: RouteInboundMessageInput,
  plan: SemanticOperationPlan,
  pendingAdjustment: Awaited<ReturnType<typeof getPendingCustomerReplacementOrder>> | undefined,
  existingDraft: DraftOrder | null,
): Promise<{ code: string; message: string } | null> {
  const allowed = new Set(allowedSemanticOperations(input.conversation.state));
  const operationTypes = plan.operations.map((operation) => operation.type);
  if (operationTypes.some((type) => !allowed.has(type))) {
    return { code: "semantic_operation_not_allowed", message: "No pude aplicar esa acción en el estado actual. Dime qué deseas hacer con tu pedido." };
  }

  const specialTypes = new Set([
    "request_human", "show_menu", "get_order_status", "reuse_billing_profile", "change_billing",
    "switch_to_electronic_billing", "edit_order", "accept_cash_fallback", "keep_transfer", "confirm_order", "cancel_order",
  ]);
  const special = plan.operations.filter((operation) => specialTypes.has(operation.type));
  if (special.length === 0) return null;
  if (special.length !== 1 || plan.operations.length !== 1) {
    return { code: "semantic_special_operation_mixed", message: "Primero resolvamos una sola decisión del pedido para continuar." };
  }

  const operation = special[0]!;
  if (["reuse_billing_profile", "change_billing", "switch_to_electronic_billing"].includes(operation.type)
    && !readPendingBillingContext(input.conversation.context)) {
    return { code: "semantic_billing_context_missing", message: "No encontré una decisión de facturación pendiente. Revisemos el estado actual del pedido." };
  }
  if (["accept_cash_fallback", "keep_transfer"].includes(operation.type)
    && input.conversation.state !== "awaiting_transfer_fallback_payment_method") {
    return { code: "semantic_transfer_fallback_not_allowed", message: "En este momento no hay una decisión de pago pendiente para cambiar." };
  }
  if (operation.type === "cancel_order" && (input.conversation.state !== "awaiting_order_adjustment" || !pendingAdjustment)) {
    return { code: "semantic_cancel_not_allowed", message: "En este momento no puedo cancelar ese ajuste pendiente." };
  }
  if (operation.type === "confirm_order") {
    if (!existingDraft || existingDraft.items.length === 0) {
      return { code: "semantic_confirm_draft_missing", message: "No encontré productos confirmables en este pedido. Revisemos el estado actual." };
    }
    if (!existingDraft.billing?.type) {
      return { code: "semantic_confirm_billing_missing", message: "Aún falta completar la información de facturación antes de confirmar." };
    }
    if (!existingDraft.paymentMethod) {
      return { code: "semantic_confirm_payment_missing", message: "Aún falta elegir el método de pago antes de confirmar." };
    }
    if (existingDraft.fulfillmentType === "delivery" && existingDraft.isInsideDeliveryCoverage !== true) {
      const settings = await getDeliveryCoverageSettings({
        env: input.env,
        schemaName: input.tenant.schemaName,
        locationId: existingDraft.locationId,
      });
      if (!settings?.allowOutOfCoverageOrders) {
        return { code: "semantic_confirm_address_missing", message: "Aún falta validar la dirección de entrega antes de confirmar." };
      }
    }
  }
  return null;
}

function buildSpecialManifestExpectation(plan: SemanticOperationPlan, draft: DraftOrder | null): ManifestExpectation {
  const operationType = plan.operations[0]?.type;
  if (operationType === "confirm_order") {
    return {
      conversationState: "awaiting_restaurant_confirmation",
      draft: draft
        ? {
            id: draft.id,
            itemCount: draft.items.length,
            total: draft.total,
            fulfillment: draft.fulfillmentType ?? null,
            payment: draft.paymentMethod ?? null,
          }
        : undefined,
      orderExpected: true,
      responseExpected: true,
    };
  }
  if (operationType === "cancel_order") return { conversationState: "completed", responseExpected: true };
  return { responseExpected: true };
}

function collectCanonicalIds(plan: SemanticOperationPlan): string[] {
  const ids = new Set<string>();
  for (const operation of plan.operations) {
    for (const key of ["menuItemId", "draftOrderItemId", "optionId"]) {
      const value = operation[key as keyof typeof operation];
      if (typeof value === "string") ids.add(value);
    }
    if (operation.type === "add_product" || operation.type === "set_line_configuration") {
      for (const selection of operation.configuration ?? []) {
        if (typeof selection.optionId === "string") ids.add(selection.optionId);
        for (const valueId of selection.valueIds ?? []) {
          if (typeof valueId === "string") ids.add(valueId);
        }
      }
    }
  }
  return [...ids].sort();
}

async function digestManifest(input: {
  operationTypes: string[];
  canonicalIds: string[];
  preconditions: string[];
  postconditionFingerprints: string[];
}): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(input));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The operation-plan model works with canonical menu IDs. This deterministic
 * guard complements it when a customer joins independent menu products in one
 * phrase (for example, "carne a la plancha con jugo de fresa"). It only adds
 * menu items explicitly found in the message and never alters configurations
 * that the model attached to the main dish.
 */
export function reconcileMenuMentionsInPlan(
  plan: SemanticOperationPlan,
  menu: TodayMenuPayload,
  rawMessage: string,
  allowedOperations: SemanticOperation["type"][],
): SemanticOperationPlan {
  if (!allowedOperations.includes("add_product") || !plan.operations.some((operation) => operation.type === "add_product")) {
    return plan;
  }

  const mentions = resolveMenuSelectionsFromText(menu, rawMessage);
  if (mentions.length === 0) {
    return plan;
  }

  const mentionedMenuItemIds = new Set(mentions.map((mention) => mention.item.id));
  // A clear textual match is stronger evidence than a model-selected ID. This
  // prevents the model from attaching "1 caldo" to a different, stale or
  // unavailable menu item when the current menu already has an exact Caldo.
  // Keep any configuration only when it belongs to the same explicitly named
  // item, then append the deterministic matches that the model omitted.
  const validAddedIds = new Set<string>();
  const operations = plan.operations.filter((operation) => {
    if (operation.type !== "add_product") return true;
    if (!operation.menuItemId || !mentionedMenuItemIds.has(operation.menuItemId)) return false;
    validAddedIds.add(operation.menuItemId);
    return true;
  });

  for (const mention of mentions) {
    if (validAddedIds.has(mention.item.id)) {
      continue;
    }
    operations.push({
      type: "add_product",
      menuItemId: mention.item.id,
      quantity: mention.quantity,
      confidence: 1,
    });
    validAddedIds.add(mention.item.id);
  }

  return operations.length === plan.operations.length && operations.every((operation, index) => operation === plan.operations[index])
    ? plan
    : { ...plan, operations };
}

async function validateOperationPlan(
  input: RouteInboundMessageInput,
  payload: {
    menu: TodayMenuPayload;
    draft: DraftOrder | null;
    plan: SemanticOperationPlan;
    pendingAdjustment?: Awaited<ReturnType<typeof getPendingCustomerReplacementOrder>>;
    pendingConfiguration?: ReturnType<typeof readPendingProductConfiguration>;
  },
): Promise<{ kind: "valid"; value: ValidatedPlan } | { kind: "invalid"; code: string; message: string } | { kind: "pending_configuration"; payload: Parameters<typeof persistPendingProductConfiguration>[1] }> {
  const allowed = new Set(allowedSemanticOperations(input.conversation.state));
  const baseItems = payload.draft?.items.map((item) => structuredClone(item)) ?? [];
  const items = baseItems;
  const patch: DraftPatch = {};
  let billing = payload.draft?.billing;
  let hasMutation = false;
  let hasItemMutation = false;
  let advancesCheckout = false;
  let addressResolution: AddressResolution | undefined;
  const unavailableMenuItemIds = new Set(payload.pendingAdjustment?.order.restaurantReviewMetadata?.unavailableItems?.map((item) => item.menuItemId).filter((id): id is string => Boolean(id)) ?? []);
  const addOperations = payload.plan.operations.filter((operation) => operation.type === "add_product");

  for (const operation of payload.plan.operations) {
    if (!allowed.has(operation.type) || (operation.confidence !== undefined && operation.confidence < 0.55)) {
      return invalid("semantic_operation_not_allowed", "No pude aplicar ese cambio en este momento. Dime qué deseas ajustar del pedido actual.");
    }
    if (operation.type === "continue_checkout") {
      advancesCheckout = true;
      continue;
    }
    if (operation.type === "confirm_order" || operation.type === "cancel_order" || operation.type === "request_human" || operation.type === "show_menu") {
      return invalid("semantic_operation_mixed_control", "Primero confirmemos o ajustemos el pedido actual, por favor.");
    }
    if (operation.type === "add_product") {
      const selected = operation.menuItemId ? payload.menu.items.find((item) => item.id === operation.menuItemId) : undefined;
      if (!selected) {
        return invalid("semantic_add_product_unrecognized_menu_item", "No pude identificar con seguridad uno de los productos. ¿Me lo escribes como aparece en el menú?");
      }
      if (!selected.isAvailable || selected.product?.isActive === false || unavailableMenuItemIds.has(selected.id)) {
        return invalid("semantic_add_product_unavailable_menu_item", `${selected.displayName ?? selected.product?.name ?? "Ese producto"} ya no está disponible. ¿Quieres elegir otra opción?`);
      }
      if (payload.pendingConfiguration && selected.id !== payload.pendingConfiguration.menuItemId) {
        return invalid("semantic_add_product_pending_configuration_mismatch", "Primero necesito terminar de configurar el producto que ya elegiste.");
      }
      const pendingSelections = payload.pendingConfiguration ? toSemanticConfigurationSelections(payload.pendingConfiguration.resolvedOptions) : [];
      const resolved = resolveConfiguration(
        selected,
        mergeConfigurationSelections(pendingSelections, operation.configuration),
        operation.notes ?? payload.pendingConfiguration?.notes,
        input.message.text,
      );
      if (resolved.kind === "needs_configuration") {
        return {
          kind: "pending_configuration",
          payload: {
            menu: payload.menu,
            selectedItem: selected,
            quantity: inferProductQuantity(operation, addOperations, payload.pendingAdjustment, payload.pendingConfiguration),
            source: "semantic",
            rawItemText: selected.displayName ?? selected.product?.name,
            rawOptionTexts: resolved.rawOptionTexts,
            notes: operation.notes ?? [],
            resolution: resolved.resolution,
          },
        };
      }
      if (resolved.kind === "invalid") return invalid("semantic_configuration_invalid", "Necesito confirmar una opción del producto antes de cambiar tu pedido.");
      items.push({
        menuItemId: selected.id,
        productId: selected.productId,
        comboId: selected.comboId,
        name: selected.displayName ?? selected.product?.name ?? "Producto",
        quantity: inferProductQuantity(operation, addOperations, payload.pendingAdjustment, payload.pendingConfiguration),
        unitPrice: resolved.resolution.pricing.resolvedUnitPrice,
        options: shouldPersistConfigurationSnapshot({ menuItem: selected, resolution: resolved.resolution }) ? buildOrderLineItemOptionsSnapshot(resolved.resolution) : undefined,
        notes: uniqueNotes(operation.notes).join("; ") || undefined,
        lineTotal: inferProductQuantity(operation, addOperations, payload.pendingAdjustment, payload.pendingConfiguration) * resolved.resolution.pricing.resolvedUnitPrice,
      });
      hasMutation = true;
      hasItemMutation = true;
      continue;
    }
    if (operation.type === "remove_draft_line") {
      const index = findExactDraftLine(items, operation.draftOrderItemId);
      if (index < 0) return invalid("semantic_draft_line_not_found", "No pude encontrar exactamente ese producto en tu pedido actual.");
      items.splice(index, 1);
      hasMutation = true;
      hasItemMutation = true;
      continue;
    }
    if (operation.type === "set_line_quantity") {
      const index = findExactDraftLine(items, operation.draftOrderItemId);
      if (index < 0 || !operation.quantity) return invalid("semantic_quantity_invalid", "No pude identificar la línea o cantidad que deseas cambiar.");
      const item = items[index]!;
      item.quantity = Math.max(1, Math.round(operation.quantity));
      item.lineTotal = item.quantity * item.unitPrice;
      hasMutation = true;
      hasItemMutation = true;
      continue;
    }
    if (operation.type === "set_line_notes") {
      const index = findExactDraftLine(items, operation.draftOrderItemId);
      if (index < 0) return invalid("semantic_draft_line_not_found", "No pude encontrar exactamente ese producto en tu pedido actual.");
      items[index]!.notes = uniqueNotes(operation.notes).join("; ") || undefined;
      hasMutation = true;
      hasItemMutation = true;
      continue;
    }
    if (operation.type === "set_line_configuration") {
      const index = findExactDraftLine(items, operation.draftOrderItemId);
      const line = index >= 0 ? items[index] : undefined;
      const menuItem = line?.menuItemId ? payload.menu.items.find((item) => item.id === line.menuItemId) : undefined;
      if (!line || !menuItem) return invalid("semantic_draft_line_not_found", "No pude encontrar exactamente ese producto en tu pedido actual.");
      const resolved = resolveConfiguration(menuItem, operation.configuration, operation.notes ?? line.notes?.split("; "), input.message.text);
      if (resolved.kind !== "resolved") return invalid("semantic_configuration_invalid", "Necesito confirmar una opción del producto antes de cambiar tu pedido.");
      line.options = shouldPersistConfigurationSnapshot({ menuItem, resolution: resolved.resolution }) ? buildOrderLineItemOptionsSnapshot(resolved.resolution) : undefined;
      line.notes = uniqueNotes(operation.notes ?? line.notes?.split("; ")).join("; ") || undefined;
      line.unitPrice = resolved.resolution.pricing.resolvedUnitPrice;
      line.lineTotal = line.quantity * line.unitPrice;
      hasMutation = true;
      hasItemMutation = true;
      continue;
    }
    if (operation.type === "set_fulfillment") {
      if (!operation.fulfillmentType) return invalid("semantic_fulfillment_invalid", "¿Prefieres domicilio o recoger en el local?");
      if (!hasExplicitFulfillmentEvidence(input.message.text, operation.fulfillmentType, input.conversation.state)) {
        return invalid("semantic_fulfillment_without_evidence", "No quiero asumir cómo recibirás el pedido. ¿Prefieres domicilio o recoger en el local?");
      }
      patch.fulfillmentType = operation.fulfillmentType;
      if (operation.fulfillmentType === "pickup") clearDeliveryPatch(patch);
      hasMutation = true;
      advancesCheckout = true;
      continue;
    }
    if (operation.type === "set_payment_method") {
      if (!operation.paymentMethod) return invalid("semantic_payment_invalid", "¿Prefieres pagar en efectivo o por transferencia?");
      if (!hasExplicitPaymentEvidence(input.message.text, operation.paymentMethod, input.conversation.state)) {
        return invalid("semantic_payment_without_evidence", "No quiero asumir el medio de pago. ¿Prefieres efectivo o transferencia?");
      }
      patch.paymentMethod = operation.paymentMethod;
      hasMutation = true;
      advancesCheckout = true;
      continue;
    }
    if (operation.type === "set_delivery_address") {
      if (!operation.addressText?.trim()) return invalid("semantic_address_invalid", "Compárteme una dirección completa para continuar.");
      const candidateFulfillment = patch.fulfillmentType ?? payload.draft?.fulfillmentType;
      if (candidateFulfillment !== "delivery") return invalid("semantic_address_without_delivery", "Primero confirmemos que el pedido será a domicilio.");
      const addressResult = await resolveWrittenAddress(input, payload.menu, operation.addressText, operation.addressDetails);
      Object.assign(patch, addressResult.patch);
      addressResolution = addressResult;
      logRoutingDiagnostic(input, "semantic_delivery_address.coverage_evaluated", {
        outcome: addressResult.coverageOutcome,
        validationMethod: addressResult.validationMethod,
        confidence: addressResult.confidence,
      });
      hasMutation = true;
      advancesCheckout = true;
      continue;
    }
    if (operation.type === "set_billing") {
      const resolvedBilling = validateBilling(operation.billing, projectDraft(payload.draft, {
        items,
        patch,
        billing,
        hasMutation,
        hasItemMutation,
        advancesCheckout,
      }, payload.menu));
      if (!resolvedBilling) return invalid("semantic_billing_invalid", "Necesito los datos completos de facturación para guardar esa información.");
      billing = resolvedBilling;
      hasMutation = true;
      advancesCheckout = true;
    }
  }

  if (input.conversation.state === "awaiting_order_adjustment" && items.length === 0) {
    return invalid("semantic_adjustment_empty_order", "El pedido no puede quedar sin productos. Dime qué productos deseas agregar.");
  }
  return {
    kind: "valid",
    value: {
      items: consolidateOrderLineItems(items),
      patch,
      billing,
      hasMutation,
      hasItemMutation,
      advancesCheckout,
      addressResolution,
    },
  };
}

function resolveConfiguration(menuItem: MenuItem, configuration: SemanticConfigurationSelection[] | undefined, notes?: string[], rawMessage?: string) {
  const rawOptionTexts: Array<{ groupText?: string; valueText: string }> = [];
  for (const selection of configuration ?? []) {
    const option = menuItem.product?.options?.find((candidate) => candidate.id === selection.optionId);
    if (!option) return { kind: "invalid" as const };
    if (option.type === "text") {
      if (!selection.textValue?.trim() || (selection.valueIds?.length ?? 0) > 0) return { kind: "invalid" as const };
      rawOptionTexts.push({ groupText: option.name, valueText: selection.textValue.trim() });
      continue;
    }
    if (selection.textValue || !(selection.valueIds?.length)) return { kind: "invalid" as const };
    for (const valueId of selection.valueIds) {
      const value = option.values.find((candidate) => candidate.id === valueId && candidate.isActive);
      if (!value) return { kind: "invalid" as const };
      rawOptionTexts.push({ groupText: option.name, valueText: value.name });
    }
  }
  const explicitOptionTexts = rawMessage ? extractExplicitConfigurationOptionTexts(menuItem, rawMessage) : [];
  for (const entry of explicitOptionTexts) {
    if (!rawOptionTexts.some((current) => current.groupText === entry.groupText && current.valueText === entry.valueText)) {
      rawOptionTexts.push(entry);
    }
  }
  const skippedOptionIds = rawMessage
    ? (menuItem.product?.options ?? [])
        .filter((option) => option.id && isExplicitConfigurationSkip(option, rawMessage))
        .map((option) => option.id!)
    : [];
  const resolution = resolveProductConfiguration({ menuItem, source: "semantic", rawOptionTexts, freeTextNotes: uniqueNotes(notes), skippedOptionIds });
  if (resolution.status === "needs_clarification") return { kind: "needs_configuration" as const, resolution, rawOptionTexts };
  if (resolution.status !== "resolved") return { kind: "invalid" as const };
  return { kind: "resolved" as const, resolution };
}

async function resolveWrittenAddress(input: RouteInboundMessageInput, menu: TodayMenuPayload, text: string, details?: string | null): Promise<AddressResolution> {
  const segmented = segmentDeliveryAddress({ addressText: text, details: details ?? undefined });
  const patch: DraftPatch = {
    deliveryAddress: segmented.addressText,
    deliveryAddressDetails: segmented.details,
    customerAddressText: segmented.addressText,
    resolvedDeliveryAddress: segmented.addressText,
    customerLatitude: null,
    customerLongitude: null,
    deliveryDistanceKm: null,
    isInsideDeliveryCoverage: null,
    coverageValidationMethod: "not_validated",
    coverageConfidence: "failed",
    coverageCheckedAt: null,
  };
  const settings = await getDeliveryCoverageSettings({ env: input.env, schemaName: input.tenant.schemaName, locationId: menu.location?.id });
  try {
    const validation = await validateDeliveryCoverageFromWrittenAddress({ env: input.env, schemaName: input.tenant.schemaName, locationId: menu.location?.id, addressText: segmented.addressText });
    if (validation) {
      patch.customerLatitude = validation.latitude;
      patch.customerLongitude = validation.longitude;
      patch.deliveryDistanceKm = validation.distanceKm;
      patch.isInsideDeliveryCoverage = validation.isInsideCoverage;
      patch.coverageValidationMethod = validation.validationMethod;
      patch.coverageConfidence = validation.confidence;
      patch.coverageCheckedAt = new Date().toISOString();
      patch.customerAddressText = validation.formattedAddress;
      patch.resolvedDeliveryAddress = validation.formattedAddress;
      if (validation.isInsideCoverage) {
        return {
          patch,
          coverageOutcome: "inside",
          validationMethod: validation.validationMethod,
          confidence: validation.confidence,
        };
      }
      return {
        patch,
        coverageOutcome: settings?.allowOutOfCoverageOrders ? "outside_allowed" : "outside",
        validationMethod: validation.validationMethod,
        confidence: validation.confidence,
      };
    }
  } catch {
    return { patch, coverageOutcome: "provider_error", validationMethod: "not_validated", confidence: "failed" };
  }
  return { patch, coverageOutcome: "unresolved", validationMethod: "not_validated", confidence: "failed" };
}

function validateBilling(input: SemanticBillingInput | null | undefined, draft: DraftOrder): NonNullable<DraftOrder["billing"]> | null {
  if (!input) return null;
  if (input.type === "normal" && input.fullName?.trim()) {
    return applyBillingDefaults({ type: "normal", fullName: input.fullName.trim(), billingAddress: input.billingAddress?.trim() || undefined }, draft);
  }
  if (input.type === "electronic" && input.legalName?.trim() && input.taxId?.trim() && input.email?.includes("@")) {
    return { type: "electronic", legalName: input.legalName.trim(), taxId: input.taxId.trim(), email: input.email.trim() };
  }
  return null;
}

function projectDraft(base: DraftOrder | null, value: ValidatedPlan, menu: TodayMenuPayload): DraftOrder {
  const fulfillmentType = value.patch.fulfillmentType ?? base?.fulfillmentType;
  const totals = calculateDraftTotals({ items: value.items, fulfillmentType, deliveryFeeFixed: menu.location?.deliveryFeeFixed ?? 0, discountTotal: base?.discountTotal ?? 0 });
  return {
    id: base?.id ?? "",
    status: base?.status ?? "draft",
    locationId: base?.locationId ?? menu.location?.id,
    fulfillmentType,
    serviceTiming: base?.serviceTiming ?? "asap",
    deliveryAddress: value.patch.deliveryAddress ?? base?.deliveryAddress,
    deliveryAddressDetails: value.patch.deliveryAddressDetails ?? base?.deliveryAddressDetails,
    customerAddressText: value.patch.customerAddressText ?? base?.customerAddressText,
    resolvedDeliveryAddress: value.patch.resolvedDeliveryAddress ?? base?.resolvedDeliveryAddress,
    customerLatitude: value.patch.customerLatitude ?? base?.customerLatitude,
    customerLongitude: value.patch.customerLongitude ?? base?.customerLongitude,
    deliveryDistanceKm: value.patch.deliveryDistanceKm ?? base?.deliveryDistanceKm,
    isInsideDeliveryCoverage: value.patch.isInsideDeliveryCoverage ?? base?.isInsideDeliveryCoverage,
    coverageValidationMethod: value.patch.coverageValidationMethod ?? base?.coverageValidationMethod,
    coverageConfidence: value.patch.coverageConfidence ?? base?.coverageConfidence,
    coverageCheckedAt: value.patch.coverageCheckedAt ?? base?.coverageCheckedAt,
    paymentMethod: value.patch.paymentMethod ?? base?.paymentMethod,
    billing: value.billing ?? base?.billing,
    items: value.items,
    ...totals,
    validationErrors: base?.validationErrors,
  };
}

async function resolveNextStep(input: RouteInboundMessageInput, draft: DraftOrder, menu: TodayMenuPayload, flow: {
  isAdjustment: boolean;
  hasItemMutation: boolean;
  advancesCheckout: boolean;
  addressResolution?: AddressResolution;
}): Promise<NextStep> {
  if (flow.addressResolution?.coverageOutcome === "outside" || flow.addressResolution?.coverageOutcome === "unresolved" || flow.addressResolution?.coverageOutcome === "provider_error") {
    return { state: "awaiting_address", addressCoverageOutcome: flow.addressResolution.coverageOutcome };
  }
  if (flow.isAdjustment) return { state: "awaiting_confirmation" };
  if (draft.items.length === 0) return { state: "awaiting_guided_item_selection" };
  if (
    flow.hasItemMutation
    && !flow.advancesCheckout
    && ["awaiting_mode_selection", "awaiting_guided_item_selection", "awaiting_more_items"].includes(input.conversation.state)
  ) {
    return { state: "awaiting_more_items" };
  }
  if (!draft.fulfillmentType) return { state: "awaiting_fulfillment_type" };
  const settings = await getDeliveryCoverageSettings({ env: input.env, schemaName: input.tenant.schemaName, locationId: draft.locationId ?? menu.location?.id });
  const allowsValidatedOutOfCoverageDelivery = settings?.allowOutOfCoverageOrders === true
    && draft.coverageValidationMethod === "geocoded_address"
    && draft.isInsideDeliveryCoverage === false;
  if (draft.fulfillmentType === "delivery" && !hasValidatedDeliveryCoverage(draft) && !allowsValidatedOutOfCoverageDelivery) return { state: "awaiting_address" };
  if (!draft.billing?.type) {
    const profiles = await loadCustomerBillingProfiles({ env: input.env, schemaName: input.tenant.schemaName, customerId: input.conversation.customerId });
    const normal = profiles.find((profile) => profile.type === "normal");
    if (normal) {
      return {
        state: "awaiting_billing_reuse_confirmation",
        context: {
          ...input.conversation.context,
          pendingBilling: { type: "normal", shouldReuseDeliveryAddress: draft.fulfillmentType === "delivery", reuseProfileId: normal.id, fullName: normal.fullName, billingAddress: normal.billingAddress },
        },
        billingReuseLabel: normal.fullName ?? "información guardada",
      };
    }
    return { state: "awaiting_normal_billing_info" };
  }
  if (!draft.paymentMethod) return { state: "awaiting_payment_method" };
  return { state: "awaiting_confirmation" };
}

async function sendOrderStepMessage(input: RouteInboundMessageInput, draft: DraftOrder, menu: TodayMenuPayload, next: NextStep): Promise<void> {
  if (next.addressCoverageOutcome === "outside") {
    await sendAndLogText(input, "No tenemos cobertura para esa dirección. Envíame otra dirección completa, comparte tu ubicación de WhatsApp, elige recoger en el local o escribe “asesor” si prefieres ayuda.");
    return;
  }
  if (next.addressCoverageOutcome === "unresolved" || next.addressCoverageOutcome === "provider_error") {
    await sendAndLogText(input, "No pude validar esa dirección todavía. Envíame una dirección más completa o comparte tu ubicación de WhatsApp. Si prefieres, escribe “asesor” para recibir ayuda.");
    return;
  }
  if (next.addressCoverageOutcome === "inside") {
    await sendAndLogText(input, "Perfecto, validamos tu dirección y está dentro de cobertura.");
  }
  if (next.addressCoverageOutcome === "outside_allowed") {
    await sendAndLogText(input, "La dirección está fuera de la cobertura habitual, pero el restaurante permite continuar con el domicilio.");
  }
  if (next.state === "awaiting_confirmation") {
    await sendAndLogText(input, buildOrderSummaryText(draft, draft.paymentMethod ?? "cash"));
    return;
  }

  const snapshot = buildOrderProgressSnapshot(draft);
  let prompt: string;
  switch (next.state) {
    case "awaiting_fulfillment_type": prompt = buildFulfillmentPrompt(menu); break;
    case "awaiting_address": prompt = "Compárteme tu ubicación de WhatsApp o una dirección completa para validar el domicilio."; break;
    case "awaiting_billing_reuse_confirmation": prompt = `Tengo datos de facturación guardados a nombre de ${next.billingReuseLabel}. ¿Los dejamos igual o deseas cambiarlos?`; break;
    case "awaiting_normal_billing_info": prompt = buildNormalBillingPrompt({ fulfillmentType: draft.fulfillmentType, billingAddress: draft.resolvedDeliveryAddress ?? draft.deliveryAddress }); break;
    case "awaiting_electronic_billing_info": prompt = buildElectronicBillingPrompt(); break;
    case "awaiting_payment_method": prompt = buildPaymentPrompt(draft, menu); break;
    case "awaiting_more_items": prompt = "¿Te gustaría agregar algo más o prefieres que sigamos con la entrega?"; break;
    case "awaiting_guided_item_selection": prompt = "Cuéntame qué productos deseas agregar al pedido."; break;
    default: prompt = buildClarificationPrompt(next.state); break;
  }
  await sendAndLogText(input, `${snapshot}\n\n${prompt}`);
}

async function tryHandleSemanticControl(input: RouteInboundMessageInput, operation: SemanticOperation): Promise<boolean> {
  switch (operation.type) {
    case "reuse_billing_profile":
      return tryHandleBillingReuseConfirmation(input, { billingDecision: "reuse" });
    case "change_billing":
      return tryHandleBillingReuseConfirmation(input, { billingDecision: "change" });
    case "switch_to_electronic_billing":
      return tryHandleBillingReuseConfirmation(input, { billingDecision: "switch_to_electronic" });
    case "edit_order":
      return tryHandleConfirmation(input, { confirmation: "change" });
    case "accept_cash_fallback":
      return tryHandleTransferFallbackPaymentMethod(input, { paymentMethod: "cash" });
    case "keep_transfer":
      return tryHandleTransferFallbackPaymentMethod(input, { paymentMethod: "transfer" });
    default:
      return false;
  }
}

function inferProductQuantity(
  operation: SemanticOperation,
  additions: SemanticOperation[],
  pendingAdjustment: Awaited<ReturnType<typeof getPendingCustomerReplacementOrder>> | undefined,
  pendingConfiguration: ReturnType<typeof readPendingProductConfiguration> | undefined,
): number {
  if (operation.quantity) return Math.max(1, Math.round(operation.quantity));
  if (pendingConfiguration) return pendingConfiguration.quantity;
  const unavailable = pendingAdjustment?.order.restaurantReviewMetadata?.unavailableItems ?? [];
  return additions.length === 1 && unavailable.length === 1 ? Math.max(1, unavailable[0]!.quantity) : 1;
}

function toSemanticConfigurationSelections(options: OrderLineItemResolvedOption[]): SemanticConfigurationSelection[] {
  return options
    .filter((option): option is OrderLineItemResolvedOption & { optionId: string } => Boolean(option.optionId))
    .map((option) => ({
      optionId: option.optionId,
      valueIds: option.selectedValues?.map((value) => value.valueId).filter((id): id is string => Boolean(id)),
      textValue: option.textValue ?? null,
    }));
}

function mergeConfigurationSelections(
  existing: SemanticConfigurationSelection[],
  proposed: SemanticConfigurationSelection[] | undefined,
): SemanticConfigurationSelection[] {
  const byOptionId = new Map(existing.map((selection) => [selection.optionId, selection]));
  for (const selection of proposed ?? []) {
    byOptionId.set(selection.optionId, selection);
  }
  return [...byOptionId.values()];
}

function contextAfterSemanticPlan(
  input: RouteInboundMessageInput,
  nextContext: NextStep["context"],
  pendingConfiguration: ReturnType<typeof readPendingProductConfiguration>,
): Record<string, unknown> | undefined {
  if (!pendingConfiguration) return nextContext;
  const context = { ...(nextContext ?? input.conversation.context) };
  delete context.pendingConfig;
  return context;
}

function findExactDraftLine(items: OrderLineItem[], id: string | null | undefined): number {
  return id ? items.findIndex((item) => item.id === id) : -1;
}

function uniqueNotes(notes: string[] | null | undefined): string[] {
  return Array.from(new Set((notes ?? []).map((note) => note.trim()).filter(Boolean)));
}

function clearDeliveryPatch(patch: DraftPatch): void {
  patch.deliveryAddress = undefined;
  patch.deliveryAddressDetails = undefined;
  patch.customerAddressText = undefined;
  patch.resolvedDeliveryAddress = undefined;
  patch.customerLatitude = undefined;
  patch.customerLongitude = undefined;
  patch.deliveryDistanceKm = undefined;
  patch.isInsideDeliveryCoverage = undefined;
  patch.coverageValidationMethod = "not_validated";
  patch.coverageConfidence = undefined;
  patch.coverageCheckedAt = undefined;
}

function invalid(code: string, message: string) {
  return { kind: "invalid" as const, code, message };
}

function classifySemanticFailure(error: unknown): string {
  if (error instanceof SemanticOperationPlanInferenceError) {
    const finalFailure = semanticOperationPlanFailureDiagnostics(error).finalFailure;
    if (finalFailure && typeof finalFailure === "object" && "errorCode" in finalFailure && typeof finalFailure.errorCode === "string") {
      return finalFailure.errorCode;
    }
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("timeout")) return "provider_timeout";
  if (message.includes("network")) return "provider_network_error";
  if (message.includes("quota")) return "provider_quota_exceeded";
  if (message.includes("stale")) return "concurrency_conflict";
  if (message.includes("supabase_rpc_failed")) return "draft_operation_rpc_failed";
  if (message.includes("semantic_parser.not_configured")) return "semantic_provider_not_configured";
  return "unknown_failure";
}

function semanticOperationFailureDiagnostics(error: unknown): Record<string, unknown> {
  if (error instanceof SupabaseRestError) {
    let upstreamCode: string | undefined;
    let upstreamDetails: string | undefined;
    try {
      const parsed = JSON.parse(error.body) as unknown;
      if (isRecord(parsed)) {
        upstreamCode = typeof parsed.code === "string" ? parsed.code : undefined;
        upstreamDetails = typeof parsed.message === "string"
          ? sanitizeErrorDetail(parsed.message)
          : typeof parsed.details === "string"
            ? sanitizeErrorDetail(parsed.details)
            : undefined;
      }
    } catch {
      upstreamDetails = sanitizeErrorDetail(error.body);
    }

    return {
      category: "database",
      code: error.message,
      httpStatus: error.status,
      upstreamCode,
      safeDetail: upstreamDetails,
      retriable: error.status >= 500 || error.status === 409,
    };
  }

  return {
    category: "internal",
    ...safeErrorSummary(error),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function handleSemanticProviderFailure(
  input: RouteInboundMessageInput,
  diagnostics: Record<string, unknown>,
): Promise<void> {
  const client = createSupabaseRestClient(input.env);
  await client.insert({
    schema: input.tenant.schemaName,
    table: "app_events",
    rows: {
      conversation_id: input.conversation.id,
      draft_order_id: input.conversation.currentDraftOrderId,
      event_name: "ai.semantic_plan.failed",
      severity: "error",
      source: "message_router",
      metadata: {
        traceId: input.traceId,
        orderChanged: false,
        diagnostics,
      },
    },
  }).catch((eventError: unknown) => {
    logRoutingDiagnostic(input, "semantic_operation_plan.event_persist_failed", {
      error: safeErrorSummary(eventError),
    });
  });

  const [existingAlert] = await client.select<{ id: string }>({
    schema: input.tenant.schemaName,
    table: "human_intervention_alerts",
    query: {
      select: "id",
      conversation_id: `eq.${input.conversation.id}`,
      type: "eq.technical_error",
      status: "in.(open,acknowledged)",
      limit: 1,
    },
  }).catch(() => []);

  if (!existingAlert) {
    await persistHumanInterventionAlert({
      env: input.env,
      schemaName: input.tenant.schemaName,
      alert: {
        conversationId: input.conversation.id,
        draftOrderId: input.conversation.currentDraftOrderId,
        type: "technical_error",
        title: "No se pudo interpretar un pedido",
        description: "El proveedor de IA no pudo completar una operación semántica. El pedido no fue modificado.",
        metadata: {
          source: "semantic_operation_plan",
          ...diagnostics,
        },
      },
    }).catch((alertError: unknown) => {
      logRoutingDiagnostic(input, "semantic_operation_plan.alert_failed", {
        reason: classifySemanticFailure(alertError),
      });
    });
  }

  await sendAndLogText(
    input,
    "Estoy teniendo un inconveniente temporal para procesar tu pedido. Tu pedido no cambió. Inténtalo de nuevo en unos minutos o escribe asesor para recibir ayuda.",
  );
}
