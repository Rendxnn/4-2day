import { getOrCreateActiveDraftOrder, updateDraftOrderPaymentMethod } from "../../draft-orders/service";
import { updateConversationStateForRoute } from "../shared/effects";
import { buildDeliveryAddressPrompt, buildOrderSummaryText } from "../../../modules/message-router/response-composer";
import { loadCurrentMenu } from "../shared/helpers";
import { sendAndLogText } from "../outbound/send";
import type { RouteInboundMessageInput } from "../shared/types";
import { getDeliveryCoverageSettings } from "../../delivery-coverage/service";
import { buildCoverageRequestMessage } from "./address-prompts";
import { startBillingStep } from "./billing";

export async function tryHandlePaymentMethod(input: RouteInboundMessageInput, signals: {
  paymentMethod?: "cash" | "transfer" | null;
}): Promise<boolean> {
  if (!signals.paymentMethod) {
    return false;
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

  const updatedDraft = await updateDraftOrderPaymentMethod({
    env: input.env,
    schemaName: input.tenant.schemaName,
    draftOrderId: draft.id,
    paymentMethod: signals.paymentMethod,
    deliveryFeeFixed: menu.location?.deliveryFeeFixed,
  });

  if (updatedDraft.fulfillmentType === "delivery" && updatedDraft.isInsideDeliveryCoverage !== true) {
    const settings = await getDeliveryCoverageSettings({
      env: input.env,
      schemaName: input.tenant.schemaName,
      locationId: updatedDraft.locationId ?? menu.location?.id,
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

  if (!updatedDraft.billing?.type) {
    await startBillingStep(input, { menu, draft: updatedDraft });
    return true;
  }

  await updateConversationStateForRoute(input, {
    state: "awaiting_confirmation",
    resetClarificationAttempts: true,
  });

  await sendAndLogText(input, buildOrderSummaryText(updatedDraft, signals.paymentMethod));
  return true;
}
