import { calculateDraftTotals } from "@42day/core";
import type { Conversation, DraftOrder, FulfillmentType, MenuItem, OrderBillingDetails, OrderLineItem, OrderLineItemOptionsSnapshot, PaymentMethod } from "@42day/types";
import type { ApiBindings } from "../../lib/bindings";
import { logEvent } from "../../lib/observability/logger.ts";
import { createSupabaseRestClient } from "../../lib/supabase-rest";
import {
  createDraftOrderRow,
  deleteDraftOrderItem,
  insertDraftOrderItem,
  linkConversationToDraftOrder,
  loadDraftOrderById,
  loadDraftOrderItems,
  loadDraftOrderState,
  loadReusableDraftOrderByConversation,
  updateDraftOrderItem,
  updateDraftOrderRow,
} from "./repository";
import { markDraftReadyIfValid, mapDraftOrder, mapLineItem } from "./mappers";
import { findMatchingDraftOrderItemRows } from "./matching";
import { consolidateOrderLineItems } from "./consolidation.ts";

export { createEmptyDraftOrder, markDraftReadyIfValid } from "./mappers";

export async function getOrCreateActiveDraftOrder(input: {
  env: ApiBindings;
  schemaName: string;
  conversation: Conversation;
  customerId: string;
  locationId?: string;
  deliveryFeeFixed?: number;
}): Promise<DraftOrder> {
  const candidateId = input.conversation.currentDraftOrderId;
  if (candidateId) {
    const existing = await loadDraftOrderById({
      env: input.env,
      schemaName: input.schemaName,
      draftOrderId: candidateId,
    });

    if (existing) {
      const items = await loadDraftOrderItems({
        env: input.env,
        schemaName: input.schemaName,
        draftOrderId: existing.id,
      });

      return mapDraftOrder(existing, items.map(mapLineItem));
    }
  }

  const reusable = await loadReusableDraftOrderByConversation({
    env: input.env,
    schemaName: input.schemaName,
    conversationId: input.conversation.id,
  });

  if (reusable) {
    const items = await loadDraftOrderItems({
      env: input.env,
      schemaName: input.schemaName,
      draftOrderId: reusable.id,
    });
    return mapDraftOrder(reusable, items.map(mapLineItem));
  }

  const created = await createDraftOrderRow({
    env: input.env,
    schemaName: input.schemaName,
    conversationId: input.conversation.id,
    customerId: input.customerId,
    locationId: input.locationId,
  });

  await linkConversationToDraftOrder({
    env: input.env,
    schemaName: input.schemaName,
    conversationId: input.conversation.id,
    draftOrderId: created.id,
  });

  return mapDraftOrder(created, []);
}

/**
 * Reads the currently reusable draft without creating or linking anything.
 * Semantic plans use this before validation so an invalid model response can
 * never leave an empty draft behind.
 */
export async function loadActiveDraftOrder(input: {
  env: ApiBindings;
  schemaName: string;
  conversation: Conversation;
}): Promise<DraftOrder | null> {
  const candidate = input.conversation.currentDraftOrderId
    ? await loadDraftOrderById({
        env: input.env,
        schemaName: input.schemaName,
        draftOrderId: input.conversation.currentDraftOrderId,
      })
    : await loadReusableDraftOrderByConversation({
        env: input.env,
        schemaName: input.schemaName,
        conversationId: input.conversation.id,
      });

  if (!candidate) return null;

  const items = await loadDraftOrderItems({
    env: input.env,
    schemaName: input.schemaName,
    draftOrderId: candidate.id,
  });
  return mapDraftOrder(candidate, items.map(mapLineItem));
}

export async function applySemanticDraftOperationPlan(input: {
  env: ApiBindings;
  schemaName: string;
  conversation: Conversation;
  customerId: string;
  locationId?: string;
  draftOrderId?: string;
  expectedDraftUpdatedAt?: string;
  items: OrderLineItem[];
  patch: {
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
  billing?: OrderBillingDetails;
  nextState: Conversation["state"];
  context?: Conversation["context"];
}): Promise<DraftOrder> {
  const canonicalItems = consolidateOrderLineItems(input.items);
  const response = await createSupabaseRestClient(input.env).rpc<{ draftId?: string }>({
    schema: input.schemaName,
    functionName: "apply_semantic_draft_operation_plan",
    args: {
      p_conversation_id: input.conversation.id,
      p_customer_id: input.customerId,
      p_location_id: input.locationId ?? null,
      p_expected_conversation_updated_at: input.conversation.updatedAt,
      p_draft_order_id: input.draftOrderId ?? input.conversation.currentDraftOrderId ?? null,
      p_expected_draft_updated_at: input.expectedDraftUpdatedAt ?? null,
      p_items: canonicalItems.map((item) => ({
        menuItemId: item.menuItemId ?? null,
        productId: item.productId ?? null,
        comboId: item.comboId ?? null,
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        options: item.options ?? null,
        notes: item.notes ?? null,
        lineTotal: item.lineTotal,
      })),
      p_patch: input.patch,
      p_billing: input.billing ?? null,
      p_next_state: input.nextState,
      p_context: input.context ?? input.conversation.context,
    },
  });

  const draftId = response.draftId;
  if (!draftId) throw new Error("semantic_draft_operation.rpc_missing_draft");
  const row = await loadDraftOrderById({ env: input.env, schemaName: input.schemaName, draftOrderId: draftId });
  if (!row) throw new Error("semantic_draft_operation.draft_not_found_after_apply");
  const items = await loadDraftOrderItems({ env: input.env, schemaName: input.schemaName, draftOrderId: draftId });
  return mapDraftOrder(row, items.map(mapLineItem));
}

export async function addMenuItemToDraftOrder(input: {
  env: ApiBindings;
  schemaName: string;
  draftOrderId: string;
  menuItem: MenuItem;
  quantity?: number;
  options?: OrderLineItemOptionsSnapshot;
  notes?: string;
  unitPrice?: number;
  deliveryFeeFixed?: number;
}): Promise<DraftOrder> {
  const quantity = Math.max(1, input.quantity ?? 1);
  const unitPrice = input.unitPrice ?? input.menuItem.priceOverride ?? input.menuItem.product?.basePrice ?? 0;
  const existingRows = await loadDraftOrderItems({
    env: input.env,
    schemaName: input.schemaName,
    draftOrderId: input.draftOrderId,
  });
  const existing = input.options || input.notes
    ? undefined
    : existingRows.find((row) => row.menu_item_id === input.menuItem.id);

  if (existing) {
    const nextQuantity = existing.quantity + quantity;
    await updateDraftOrderItem({
      env: input.env,
      schemaName: input.schemaName,
      id: existing.id,
      quantity: nextQuantity,
      lineTotal: nextQuantity * existing.unit_price,
    });
  } else {
    await insertDraftOrderItem({
      env: input.env,
      schemaName: input.schemaName,
      draftOrderId: input.draftOrderId,
      menuItem: input.menuItem,
      quantity,
      options: input.options,
      notes: input.notes,
      unitPrice,
    });
  }

  return recalculateDraftOrder({
    env: input.env,
    schemaName: input.schemaName,
    draftOrderId: input.draftOrderId,
    deliveryFeeFixed: input.deliveryFeeFixed ?? 0,
  });
}

export async function removeItemsFromDraftOrder(input: {
  env: ApiBindings;
  schemaName: string;
  draftOrderId: string;
  menuItem?: Pick<MenuItem, "id" | "productId" | "displayName" | "product">;
  targetText?: string;
  quantity?: number;
  deliveryFeeFixed?: number;
}): Promise<{ draft: DraftOrder; changed: boolean }> {
  const rows = await loadDraftOrderItems({
    env: input.env,
    schemaName: input.schemaName,
    draftOrderId: input.draftOrderId,
  });
  const matches = findMatchingDraftOrderItemRows(rows, {
    menuItem: input.menuItem,
    targetText: input.targetText,
  });

  if (matches.length === 0) {
    const draft = await recalculateDraftOrder({
      env: input.env,
      schemaName: input.schemaName,
      draftOrderId: input.draftOrderId,
      deliveryFeeFixed: input.deliveryFeeFixed ?? 0,
    });
    return { draft, changed: false };
  }

  const quantityToRemove = input.quantity && input.quantity > 0 ? Math.round(input.quantity) : undefined;

  for (const row of matches) {
    if (quantityToRemove && quantityToRemove < row.quantity) {
      const nextQuantity = row.quantity - quantityToRemove;
      await updateDraftOrderItem({
        env: input.env,
        schemaName: input.schemaName,
        id: row.id,
        quantity: nextQuantity,
        lineTotal: nextQuantity * row.unit_price,
      });
      continue;
    }

    await deleteDraftOrderItem({
      env: input.env,
      schemaName: input.schemaName,
      id: row.id,
    });
  }

  const draft = await recalculateDraftOrder({
    env: input.env,
    schemaName: input.schemaName,
    draftOrderId: input.draftOrderId,
    deliveryFeeFixed: input.deliveryFeeFixed ?? 0,
  });

  return { draft, changed: true };
}

export async function setDraftOrderItemQuantity(input: {
  env: ApiBindings;
  schemaName: string;
  draftOrderId: string;
  menuItem?: Pick<MenuItem, "id" | "productId" | "displayName" | "product">;
  targetText?: string;
  quantity: number;
  deliveryFeeFixed?: number;
}): Promise<{ draft: DraftOrder; changed: boolean }> {
  if (input.quantity <= 0) {
    return removeItemsFromDraftOrder({
      ...input,
      quantity: undefined,
    });
  }

  const rows = await loadDraftOrderItems({
    env: input.env,
    schemaName: input.schemaName,
    draftOrderId: input.draftOrderId,
  });
  const matches = findMatchingDraftOrderItemRows(rows, {
    menuItem: input.menuItem,
    targetText: input.targetText,
  });

  if (matches.length === 0) {
    const draft = await recalculateDraftOrder({
      env: input.env,
      schemaName: input.schemaName,
      draftOrderId: input.draftOrderId,
      deliveryFeeFixed: input.deliveryFeeFixed ?? 0,
    });
    return { draft, changed: false };
  }

  const nextQuantity = Math.max(1, Math.round(input.quantity));
  for (const row of matches) {
    await updateDraftOrderItem({
      env: input.env,
      schemaName: input.schemaName,
      id: row.id,
      quantity: nextQuantity,
      lineTotal: nextQuantity * row.unit_price,
    });
  }

  const draft = await recalculateDraftOrder({
    env: input.env,
    schemaName: input.schemaName,
    draftOrderId: input.draftOrderId,
    deliveryFeeFixed: input.deliveryFeeFixed ?? 0,
  });

  return { draft, changed: true };
}

export async function updateDraftOrderFulfillment(input: {
  env: ApiBindings;
  schemaName: string;
  draftOrderId: string;
  fulfillmentType: FulfillmentType;
  deliveryFeeFixed?: number;
}): Promise<DraftOrder> {
  const patch: Record<string, unknown> = {
    fulfillment_type: input.fulfillmentType,
  };

  if (input.fulfillmentType === "pickup") {
    patch.delivery_address = null;
    patch.delivery_address_details = null;
    patch.delivery_address_id = null;
    patch.customer_address_text = null;
    patch.resolved_delivery_address = null;
    patch.customer_latitude = null;
    patch.customer_longitude = null;
    patch.delivery_distance_km = null;
    patch.is_inside_delivery_coverage = null;
    patch.coverage_validation_method = "not_validated";
    patch.coverage_confidence = null;
    patch.coverage_checked_at = null;
  }

  await updateDraftOrderRow({
    env: input.env,
    schemaName: input.schemaName,
    draftOrderId: input.draftOrderId,
    values: patch,
  });

  return recalculateDraftOrder({
    env: input.env,
    schemaName: input.schemaName,
    draftOrderId: input.draftOrderId,
    deliveryFeeFixed: input.deliveryFeeFixed ?? 0,
  });
}

export async function updateDraftOrderDeliveryAddress(input: {
  env: ApiBindings;
  schemaName: string;
  draftOrderId: string;
  addressText: string;
  addressDetails?: string;
  deliveryAddressId?: string;
  deliveryFeeFixed?: number;
}): Promise<DraftOrder> {
  await updateDraftOrderRow({
    env: input.env,
    schemaName: input.schemaName,
    draftOrderId: input.draftOrderId,
    values: {
      delivery_address: input.addressText,
      delivery_address_details: input.addressDetails ?? null,
      delivery_address_id: input.deliveryAddressId ?? null,
      customer_address_text: input.addressText,
      resolved_delivery_address: input.addressText,
    },
  });

  return recalculateDraftOrder({
    env: input.env,
    schemaName: input.schemaName,
    draftOrderId: input.draftOrderId,
    deliveryFeeFixed: input.deliveryFeeFixed ?? 0,
  });
}

export async function updateDraftOrderCoverage(input: {
  env: ApiBindings;
  schemaName: string;
  draftOrderId: string;
  customerLatitude?: number | null;
  customerLongitude?: number | null;
  deliveryDistanceKm?: number | null;
  isInsideDeliveryCoverage?: boolean | null;
  validationMethod: DraftOrder["coverageValidationMethod"];
  confidence?: DraftOrder["coverageConfidence"] | null;
  checkedAt?: string | null;
  customerAddressText?: string | null;
  resolvedDeliveryAddress?: string | null;
  deliveryAddressId?: string | null;
  deliveryAddressDetails?: string | null;
  deliveryFeeFixed?: number;
}): Promise<DraftOrder> {
  await updateDraftOrderRow({
    env: input.env,
    schemaName: input.schemaName,
    draftOrderId: input.draftOrderId,
    values: {
      customer_latitude: input.customerLatitude ?? null,
      customer_longitude: input.customerLongitude ?? null,
      delivery_distance_km: input.deliveryDistanceKm ?? null,
      is_inside_delivery_coverage: input.isInsideDeliveryCoverage ?? null,
      coverage_validation_method: input.validationMethod ?? "not_validated",
      coverage_confidence: input.confidence ?? null,
      coverage_checked_at: input.checkedAt ?? null,
      ...(input.customerAddressText !== undefined ? {
        customer_address_text: input.customerAddressText,
        delivery_address: input.customerAddressText,
      } : {}),
      ...(input.resolvedDeliveryAddress !== undefined ? {
        resolved_delivery_address: input.resolvedDeliveryAddress,
      } : {}),
      ...(input.deliveryAddressId !== undefined ? { delivery_address_id: input.deliveryAddressId } : {}),
      ...(input.deliveryAddressDetails !== undefined ? { delivery_address_details: input.deliveryAddressDetails } : {}),
    },
  });

  return recalculateDraftOrder({
    env: input.env,
    schemaName: input.schemaName,
    draftOrderId: input.draftOrderId,
    deliveryFeeFixed: input.deliveryFeeFixed ?? 0,
  });
}

export async function updateDraftOrderPaymentMethod(input: {
  env: ApiBindings;
  schemaName: string;
  draftOrderId: string;
  paymentMethod: PaymentMethod;
  deliveryFeeFixed?: number;
}): Promise<DraftOrder> {
  await updateDraftOrderRow({
    env: input.env,
    schemaName: input.schemaName,
    draftOrderId: input.draftOrderId,
    values: {
      payment_method: input.paymentMethod,
    },
  });

  return recalculateDraftOrder({
    env: input.env,
    schemaName: input.schemaName,
    draftOrderId: input.draftOrderId,
    deliveryFeeFixed: input.deliveryFeeFixed ?? 0,
  });
}

export async function updateDraftOrderBilling(input: {
  env: ApiBindings;
  schemaName: string;
  draftOrderId: string;
  billing: OrderBillingDetails;
  deliveryFeeFixed?: number;
}): Promise<DraftOrder> {
  await updateDraftOrderRow({
    env: input.env,
    schemaName: input.schemaName,
    draftOrderId: input.draftOrderId,
    values: {
      billing_type: input.billing.type,
      billing_profile_id: input.billing.profileId ?? null,
      billing_full_name: input.billing.fullName ?? null,
      billing_address: input.billing.billingAddress ?? null,
      billing_legal_name: input.billing.legalName ?? null,
      billing_tax_id: input.billing.taxId ?? null,
      billing_email: input.billing.email ?? null,
    },
  });

  return recalculateDraftOrder({
    env: input.env,
    schemaName: input.schemaName,
    draftOrderId: input.draftOrderId,
    deliveryFeeFixed: input.deliveryFeeFixed ?? 0,
  });
}

async function recalculateDraftOrder(input: {
  env: ApiBindings;
  schemaName: string;
  draftOrderId: string;
  deliveryFeeFixed: number;
}): Promise<DraftOrder> {
  const state = await loadDraftOrderState({
    env: input.env,
    schemaName: input.schemaName,
    draftOrderId: input.draftOrderId,
  });

  if (!state) {
    throw new Error("draft_order.not_found");
  }

  const draft = mapDraftOrder(state.row, state.items.map(mapLineItem));
  const nextDraft = markDraftReadyIfValid({
    ...draft,
    ...calculateDraftTotals({
      items: draft.items,
      fulfillmentType: draft.fulfillmentType,
      deliveryFeeFixed: input.deliveryFeeFixed,
      discountTotal: draft.discountTotal,
    }),
  });

  await updateDraftOrderRow({
    env: input.env,
    schemaName: input.schemaName,
    draftOrderId: input.draftOrderId,
    values: {
      status: nextDraft.status,
      subtotal: nextDraft.subtotal,
      delivery_fee: nextDraft.deliveryFee,
      discount_total: nextDraft.discountTotal,
      total: nextDraft.total,
      validation_errors: nextDraft.validationErrors ?? [],
    },
  });

  logEvent("info", "draft_order.recalculated", "Se recalcularon los totales y el estado del borrador.", {
    environment: input.env.APP_ENV,
    schemaName: input.schemaName,
    draftOrderId: nextDraft.id,
    status: nextDraft.status,
    itemCount: nextDraft.items.length,
    totalQuantity: nextDraft.items.reduce((sum, item) => sum + item.quantity, 0),
    fulfillmentType: nextDraft.fulfillmentType ?? null,
    paymentMethod: nextDraft.paymentMethod ?? null,
    hasDeliveryAddress: Boolean(nextDraft.deliveryAddress || nextDraft.deliveryAddressId),
    billingType: nextDraft.billing?.type ?? null,
    total: nextDraft.total,
  });

  return nextDraft;
}
