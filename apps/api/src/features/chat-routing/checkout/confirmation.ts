import { getOrCreateActiveDraftOrder } from "../../draft-orders/service";
import { updateConversationStateForRoute } from "../shared/effects";
import {
  buildDeliveryAddressPrompt,
  buildEditableSummaryAdjustmentPrompt,
  buildOrderSubmittedForReviewMessage,
} from "../../../modules/message-router/response-composer";
import { loadCurrentMenu } from "../shared/helpers";
import { sendAndLogText } from "../outbound/send";
import type { RouteInboundMessageInput } from "../shared/types";
import { confirmOrderAdjustment, getPendingCustomerReplacementOrder, persistConfirmedOrder } from "../../orders/service";
import { getDeliveryCoverageSettings } from "../../delivery-coverage/service";
import { buildCoverageRequestMessage } from "./address-prompts";
import { recordHeadlessEffect } from "../shared/effects";

export async function tryHandleConfirmation(input: RouteInboundMessageInput, signals: {
  confirmation?: "yes" | "no" | "change" | null;
}): Promise<boolean> {
  if (!signals.confirmation) {
    return false;
  }

  const pendingAdjustment = await getPendingCustomerReplacementOrder({
    env: input.env,
    schemaName: input.tenant.schemaName,
    conversationId: input.conversation.id,
    currentDraftOrderId: input.conversation.currentDraftOrderId,
  });

  if (signals.confirmation === "no" || signals.confirmation === "change") {
    await updateConversationStateForRoute(input, {
      state: pendingAdjustment ? "awaiting_order_adjustment" : "awaiting_more_items",
      resetClarificationAttempts: true,
    });

    await sendAndLogText(
      input,
      buildEditableSummaryAdjustmentPrompt(),
    );
    return true;
  }

  if (pendingAdjustment) {
    const adjustedOrder = await confirmOrderAdjustment({
      env: input.env,
      schemaName: input.tenant.schemaName,
      conversationId: input.conversation.id,
      orderId: pendingAdjustment.order.id,
      expectedOrderUpdatedAt: pendingAdjustment.order.updatedAt,
    });
    await recordHeadlessEffect(input, { type: "order_mutation", id: adjustedOrder.id, status: "updated" });
    await sendAndLogText(
      input,
      buildOrderSubmittedForReviewMessage(adjustedOrder.id, adjustedOrder.paymentMethod),
    );
    return true;
  }

  const menu = await loadCurrentMenu(input);
  const draft = await getOrCreateActiveDraftOrder({
    env: input.env,
    schemaName: input.tenant.schemaName,
    conversation: input.conversation,
    customerId: input.conversation.customerId,
    locationId: menu.location?.id,
    deliveryFeeFixed: menu.location?.deliveryFeeFixed,
  });

  if (draft.fulfillmentType === "delivery" && draft.isInsideDeliveryCoverage !== true) {
    const settings = await getDeliveryCoverageSettings({
      env: input.env,
      schemaName: input.tenant.schemaName,
      locationId: draft.locationId ?? menu.location?.id,
    });
    if (!settings?.allowOutOfCoverageOrders) {
      await updateConversationStateForRoute(input, {
        state: "awaiting_address",
        resetClarificationAttempts: true,
      });
      await sendAndLogText(input, buildCoverageRequestMessage({
        requestLocationMessage: settings?.requestLocationMessage ?? buildDeliveryAddressPrompt(),
        tryGeocodeWrittenAddresses: settings?.tryGeocodeWrittenAddresses,
      }));
      return true;
    }
  }

  const order = await persistConfirmedOrder({
    env: input.env,
    schemaName: input.tenant.schemaName,
    conversationId: input.conversation.id,
    customerId: input.conversation.customerId,
    draft,
  });
  await recordHeadlessEffect(input, { type: "order_mutation", id: order.id, status: "updated" });

  await updateConversationStateForRoute(input, {
    state: "awaiting_restaurant_confirmation",
    resetClarificationAttempts: true,
  });

  await sendAndLogText(
    input,
    buildOrderSubmittedForReviewMessage(order.id, draft.paymentMethod),
  );
  return true;
}
