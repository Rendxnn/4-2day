import type { DraftOrder, MenuItem, TodayMenuPayload } from "@42day/types";
import { getOrCreateActiveDraftOrder } from "../../draft-orders/service";
import { updateConversationStateForRoute } from "../shared/effects";
import {
  buildAddMorePrompt,
  buildCurrentDraftText,
  buildDeliveryAddressPrompt,
  buildEmptyDraftPrompt,
  buildFulfillmentPrompt,
  buildOrderSummaryText,
  buildPaymentPrompt,
} from "../../../modules/message-router/response-composer";
import { buildGuidedContext, loadCurrentMenu } from "../shared/helpers";
import { sendAndLogText } from "../outbound/send";
import type { RouteInboundMessageInput } from "../shared/types";
import { getDeliveryCoverageSettings, hasValidatedDeliveryCoverage } from "../../delivery-coverage/service";
import { buildCoverageRequestMessage } from "./address-prompts";
import { startBillingStep } from "./billing";
import { applyDraftFacts } from "./draft-facts";

type CheckoutSignals = {
  fulfillmentType?: "delivery" | "pickup" | null;
  paymentMethod?: "cash" | "transfer" | null;
};

export async function continueAfterItemAdded(input: RouteInboundMessageInput, payload: {
  menu: TodayMenuPayload;
  draft: DraftOrder;
  selectedItem: MenuItem;
  quantity: number;
  signals: CheckoutSignals;
}): Promise<void> {
  const draft = await applyKnownSignalsToDraft(input, {
    menu: payload.menu,
    draft: payload.draft,
    signals: payload.signals,
  });

  if (payload.signals.fulfillmentType || payload.signals.paymentMethod || input.conversation.state === "awaiting_confirmation") {
    await proceedToNextOrderStep(input, {
      menu: payload.menu,
      draft,
      context: buildGuidedContext(payload.menu, payload.selectedItem),
    });
    return;
  }

  await updateConversationStateForRoute(input, {
    state: "awaiting_more_items",
    context: buildGuidedContext(payload.menu, payload.selectedItem),
    resetClarificationAttempts: true,
  });

  await sendAndLogText(input, buildAddMorePrompt(draft));
}

export async function applyKnownSignalsToDraft(input: RouteInboundMessageInput, payload: {
  menu: TodayMenuPayload;
  draft: DraftOrder;
  signals: CheckoutSignals;
}): Promise<DraftOrder> {
  return applyDraftFacts(input, {
    menu: payload.menu,
    draft: payload.draft,
    facts: {
      fulfillmentType: payload.signals.fulfillmentType,
      paymentMethod: payload.signals.paymentMethod,
    },
  });
}

export async function proceedToNextOrderStep(input: RouteInboundMessageInput, payload?: {
  menu?: TodayMenuPayload;
  draft?: DraftOrder;
  context?: Record<string, unknown>;
}): Promise<void> {
  const menu = payload?.menu ?? (await loadCurrentMenu(input));
  const draft = payload?.draft ?? (await getOrCreateActiveDraftOrder({
    env: input.env,
    schemaName: input.tenant.schemaName,
    conversation: input.conversation,
    customerId: input.conversation.customerId,
    locationId: menu.location?.id,
    deliveryFeeFixed: menu.location?.deliveryFeeFixed,
  }));

  if (draft.items.length === 0) {
    await updateConversationStateForRoute(input, {
      state: "awaiting_guided_item_selection",
      context: payload?.context,
      resetClarificationAttempts: true,
    });

    await sendAndLogText(input, buildEmptyDraftPrompt());
    return;
  }

  if (!draft.fulfillmentType) {
    await updateConversationStateForRoute(input, {
      state: "awaiting_fulfillment_type",
      context: payload?.context,
      resetClarificationAttempts: true,
    });

    await sendAndLogText(input, [buildCurrentDraftText(draft), buildFulfillmentPrompt(menu)].join("\n\n"));
    return;
  }

  if (
    draft.fulfillmentType === "delivery"
    && !hasValidatedDeliveryCoverage(draft)
  ) {
    const settings = await getDeliveryCoverageSettings({
      env: input.env,
      schemaName: input.tenant.schemaName,
      locationId: draft.locationId,
    });
    if (!settings?.allowOutOfCoverageOrders) {
      await updateConversationStateForRoute(input, {
        state: "awaiting_address",
        context: payload?.context,
        resetClarificationAttempts: true,
      });

      await sendAndLogText(input, buildCoverageRequestMessage({
        requestLocationMessage: settings?.requestLocationMessage ?? buildDeliveryAddressPrompt(),
        tryGeocodeWrittenAddresses: settings?.tryGeocodeWrittenAddresses,
      }));
      return;
    }
  }

  if (!draft.billing?.type) {
    await startBillingStep(input, { menu, draft, context: payload?.context });
    return;
  }

  if (!draft.paymentMethod) {
    await updateConversationStateForRoute(input, {
      state: "awaiting_payment_method",
      context: payload?.context,
      resetClarificationAttempts: true,
    });

    await sendAndLogText(input, buildPaymentPrompt(draft, menu));
    return;
  }

  await updateConversationStateForRoute(input, {
    state: "awaiting_confirmation",
    context: payload?.context,
    resetClarificationAttempts: true,
  });

  await sendAndLogText(input, buildOrderSummaryText(draft, draft.paymentMethod));
}
