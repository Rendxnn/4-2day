import type { DraftOrder, TodayMenuPayload } from "@42day/types";
import { getOrCreateActiveDraftOrder, updateDraftOrderBilling } from "../../draft-orders/service";
import { loadCustomerBillingProfiles, saveCustomerBillingProfile, toOrderBillingDetails } from "../../../modules/customer-billing-service/customer-billing-service";
import { updateConversationStateForRoute } from "../shared/effects";
import {
  buildBillingReusePrompt,
  buildElectronicBillingPrompt,
  buildElectronicBillingUnavailableMessage,
  buildNormalBillingPrompt,
} from "../../../modules/message-router/response-composer";
import { loadCurrentMenu } from "../shared/helpers";
import { sendAndLogText } from "../outbound/send";
import type { RouteInboundMessageInput } from "../shared/types";
import {
  applyBillingDefaults,
  isValidNormalBillingFullName,
  parseElectronicBillingText,
  readPendingBillingContext,
  renderBillingProfile,
  resolveBillingReuseDecision,
} from "./billing-helpers";
import { proceedToNextOrderStep } from "./progression";
import { getDeliveryCoverageSettings } from "../../delivery-coverage/service";

export async function isElectronicBillingEnabled(input: RouteInboundMessageInput, locationId?: string): Promise<boolean> {
  const settings = await getDeliveryCoverageSettings({
    env: input.env,
    schemaName: input.tenant.schemaName,
    locationId,
  });
  return settings?.electronicBillingEnabled ?? true;
}

export async function tryHandleBillingReuseConfirmation(input: RouteInboundMessageInput, signals: {
  confirmation?: "yes" | "no" | "change" | null;
  wantsElectronicBilling?: boolean;
  billingDataChanged?: boolean;
  billingDecision?: "reuse" | "change" | "switch_to_electronic" | null;
}): Promise<boolean> {
  const pending = readPendingBillingContext(input.conversation.context);
  if (!pending) {
    return false;
  }

  const resolved = resolveBillingReuseDecision(signals);

  if (resolved.switchToElectronic && pending.type !== "electronic") {
    return switchToElectronicBilling(input);
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

  if (pending.type === "electronic" && !(await isElectronicBillingEnabled(input, draft.locationId))) {
    await moveToNormalBilling(input, draft);
    return true;
  }

  if (resolved.reuseExisting && pending.reuseProfile) {
    const billing = applyBillingDefaults(toOrderBillingDetails(pending.reuseProfile), draft);
    await updateDraftOrderBilling({
      env: input.env,
      schemaName: input.tenant.schemaName,
      draftOrderId: draft.id,
      billing,
      deliveryFeeFixed: menu.location?.deliveryFeeFixed,
    });
    await proceedToNextOrderStep(input);
    return true;
  }

  if (resolved.changeBilling) {
    await updateConversationStateForRoute(input, {
      state: pending.type === "electronic" ? "awaiting_electronic_billing_info" : "awaiting_normal_billing_info",
      context: {
        ...input.conversation.context,
        pendingBilling: {
          ...pending,
          reuseProfile: undefined,
        },
      },
      resetClarificationAttempts: true,
    });

    await sendAndLogText(input, pending.type === "electronic" ? buildElectronicBillingPrompt() : buildNormalBillingPrompt({
      fulfillmentType: draft.fulfillmentType,
      billingAddress: draft.deliveryAddress,
      electronicBillingEnabled: await isElectronicBillingEnabled(input, draft.locationId),
    }));
    return true;
  }

  return false;
}

export async function tryHandleNormalBillingInfo(input: RouteInboundMessageInput, signals: {
  wantsElectronicBilling?: boolean;
}): Promise<boolean> {
  if (signals.wantsElectronicBilling) {
    return switchToElectronicBilling(input);
  }

  const fullName = (input.message.text ?? "").trim();
  if (!isValidNormalBillingFullName(fullName)) {
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

  const billing = applyBillingDefaults({
    type: "normal",
    fullName,
    billingAddress: draft.fulfillmentType === "delivery" ? draft.deliveryAddress : undefined,
  }, draft);

  const profile = await saveCustomerBillingProfile({
    env: input.env,
    schemaName: input.tenant.schemaName,
    customerId: input.conversation.customerId,
    billing,
  });

  await updateDraftOrderBilling({
    env: input.env,
    schemaName: input.tenant.schemaName,
    draftOrderId: draft.id,
    billing: {
      ...billing,
      profileId: profile.id,
    },
    deliveryFeeFixed: menu.location?.deliveryFeeFixed,
  });

  await proceedToNextOrderStep(input);
  return true;
}

export async function tryHandleElectronicBillingInfo(input: RouteInboundMessageInput): Promise<boolean> {
  const menu = await loadCurrentMenu(input);
  const draft = await getOrCreateActiveDraftOrder({
    env: input.env,
    schemaName: input.tenant.schemaName,
    conversation: input.conversation,
    customerId: input.conversation.customerId,
    locationId: menu.location?.id,
    deliveryFeeFixed: menu.location?.deliveryFeeFixed,
  });

  if (!(await isElectronicBillingEnabled(input, draft.locationId))) {
    await moveToNormalBilling(input, draft);
    return true;
  }

  const text = (input.message.text ?? "").trim();
  const parsed = parseElectronicBillingText(text);
  if (!parsed) {
    return false;
  }

  const profile = await saveCustomerBillingProfile({
    env: input.env,
    schemaName: input.tenant.schemaName,
    customerId: input.conversation.customerId,
    billing: parsed,
  });

  await updateDraftOrderBilling({
    env: input.env,
    schemaName: input.tenant.schemaName,
    draftOrderId: draft.id,
    billing: {
      ...parsed,
      profileId: profile.id,
    },
    deliveryFeeFixed: menu.location?.deliveryFeeFixed,
  });

  await proceedToNextOrderStep(input);
  return true;
}

export async function startBillingStep(
  input: RouteInboundMessageInput,
  payload: { menu: TodayMenuPayload; draft: DraftOrder; prefix?: string; context?: Record<string, unknown> },
): Promise<void> {
  const profiles = await loadCustomerBillingProfiles({
    env: input.env,
    schemaName: input.tenant.schemaName,
    customerId: input.conversation.customerId,
  });
  const normalProfile = profiles.find((profile) => profile.type === "normal");
  const pendingContext = {
    type: "normal",
    shouldReuseDeliveryAddress: payload.draft.fulfillmentType === "delivery",
  };
  const electronicBillingEnabled = await isElectronicBillingEnabled(input, payload.draft.locationId);

  if (normalProfile) {
    await updateConversationStateForRoute(input, {
      state: "awaiting_billing_reuse_confirmation",
      context: {
        ...(payload.context ?? input.conversation.context),
        pendingBilling: {
          ...pendingContext,
          reuseProfileId: normalProfile.id,
          fullName: normalProfile.fullName,
          billingAddress: normalProfile.billingAddress,
          legalName: normalProfile.legalName,
          taxId: normalProfile.taxId,
          email: normalProfile.email,
        },
      },
      resetClarificationAttempts: true,
    });

    await sendAndLogText(input, [
      payload.prefix,
      buildBillingReusePrompt({
        billingLabel: "normal",
        detail: renderBillingProfile(normalProfile, payload.draft),
      }),
    ].filter(Boolean).join("\n\n"));
    return;
  }

  await updateConversationStateForRoute(input, {
    state: "awaiting_normal_billing_info",
    context: {
      ...(payload.context ?? input.conversation.context),
      pendingBilling: pendingContext,
    },
    resetClarificationAttempts: true,
  });

  await sendAndLogText(input, [payload.prefix, buildNormalBillingPrompt({
    fulfillmentType: payload.draft.fulfillmentType,
    billingAddress: payload.draft.deliveryAddress,
    electronicBillingEnabled,
  })].filter(Boolean).join("\n\n"));
}

async function switchToElectronicBilling(input: RouteInboundMessageInput): Promise<boolean> {
  if (!(await isElectronicBillingEnabled(input))) {
    await sendAndLogText(input, buildElectronicBillingUnavailableMessage());
    return true;
  }

  const profiles = await loadCustomerBillingProfiles({
    env: input.env,
    schemaName: input.tenant.schemaName,
    customerId: input.conversation.customerId,
  });
  const electronicProfile = profiles.find((profile) => profile.type === "electronic");

  if (electronicProfile) {
    await updateConversationStateForRoute(input, {
      state: "awaiting_billing_reuse_confirmation",
      context: {
        ...input.conversation.context,
        pendingBilling: {
          type: "electronic",
          reuseProfileId: electronicProfile.id,
          legalName: electronicProfile.legalName,
          taxId: electronicProfile.taxId,
          email: electronicProfile.email,
        },
      },
      resetClarificationAttempts: true,
    });

    await sendAndLogText(input, buildBillingReusePrompt({
      billingLabel: "electrónica",
      detail: renderBillingProfile(electronicProfile, {
        id: "",
        status: "draft",
        items: [],
        subtotal: 0,
        deliveryFee: 0,
        discountTotal: 0,
        total: 0,
      }),
    }));
    return true;
  }

    await updateConversationStateForRoute(input, {
    state: "awaiting_electronic_billing_info",
    context: {
      ...input.conversation.context,
      pendingBilling: {
        ...(typeof input.conversation.context.pendingBilling === "object" && input.conversation.context.pendingBilling ? input.conversation.context.pendingBilling as Record<string, unknown> : {}),
        type: "electronic",
      },
    },
    resetClarificationAttempts: true,
  });

  await sendAndLogText(input, buildElectronicBillingPrompt());
  return true;
}

async function moveToNormalBilling(input: RouteInboundMessageInput, draft: DraftOrder): Promise<void> {
  await updateConversationStateForRoute(input, {
    state: "awaiting_normal_billing_info",
    context: {
      ...input.conversation.context,
      pendingBilling: {
        type: "normal",
        shouldReuseDeliveryAddress: draft.fulfillmentType === "delivery",
      },
    },
    resetClarificationAttempts: true,
  });

  await sendAndLogText(input, [
    buildElectronicBillingUnavailableMessage(),
    buildNormalBillingPrompt({
      fulfillmentType: draft.fulfillmentType,
      billingAddress: draft.deliveryAddress,
      electronicBillingEnabled: false,
    }),
  ].join("\n\n"));
}
