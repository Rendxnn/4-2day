import { getOrCreateActiveDraftOrder, updateDraftOrderFulfillment, updateDraftOrderPaymentMethod } from "../../draft-orders/service";
import { updateConversationStateForRoute } from "../shared/effects";
import { buildDeliveryAddressPrompt } from "../../../modules/message-router/response-composer";
import { loadCurrentMenu } from "../shared/helpers";
import { sendAndLogText } from "../outbound/send";
import type { RouteInboundMessageInput } from "../shared/types";
import { getDeliveryCoverageSettings } from "../../delivery-coverage/service";
import { proceedToNextOrderStep } from "./progression";
import { buildCoverageRequestMessage } from "./address-prompts";
import { startBillingStep } from "./billing";

export async function tryHandleFulfillmentSelection(input: RouteInboundMessageInput, signals: {
  fulfillmentType?: "delivery" | "pickup" | null;
  paymentMethod?: "cash" | "transfer" | null;
}): Promise<boolean> {
  if (!signals.fulfillmentType) {
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

  if (signals.fulfillmentType === "delivery") {
    const settings = await getDeliveryCoverageSettings({
      env: input.env,
      schemaName: input.tenant.schemaName,
      locationId: menu.location?.id,
    });
    if (!settings?.deliveryEnabled) {
      await updateConversationStateForRoute(input, {
        state: "awaiting_fulfillment_type",
        resetClarificationAttempts: true,
      });
      await sendAndLogText(input, "En este momento el restaurante no tiene domicilios activos. Puedes continuar para recoger en el local.");
      return true;
    }
  }

  let updatedDraft = await updateDraftOrderFulfillment({
    env: input.env,
    schemaName: input.tenant.schemaName,
    draftOrderId: draft.id,
    fulfillmentType: signals.fulfillmentType,
    deliveryFeeFixed: menu.location?.deliveryFeeFixed,
  });

  if (signals.paymentMethod) {
    updatedDraft = await updateDraftOrderPaymentMethod({
      env: input.env,
      schemaName: input.tenant.schemaName,
      draftOrderId: updatedDraft.id,
      paymentMethod: signals.paymentMethod,
      deliveryFeeFixed: menu.location?.deliveryFeeFixed,
    });
  }

  if (signals.fulfillmentType === "delivery") {
    const settings = await getDeliveryCoverageSettings({
      env: input.env,
      schemaName: input.tenant.schemaName,
      locationId: menu.location?.id,
    });
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

  if (signals.paymentMethod) {
    await proceedToNextOrderStep(input, {
      menu,
      draft: updatedDraft,
    });
    return true;
  }

  await startBillingStep(input, { menu, draft: updatedDraft });
  return true;
}
