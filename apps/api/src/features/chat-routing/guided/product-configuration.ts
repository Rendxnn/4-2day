import type {
  Conversation,
  DraftOrder,
  MenuItem,
  OrderLineItemOptionTextInput,
  OrderLineItemResolvedOption,
  ProductOption,
  TodayMenuPayload,
} from "@42day/types";
import { updateConversationStateForRoute } from "../shared/effects";
import {
  buildManualHandoffMessage,
  buildProductConfigurationPrompt,
} from "../../../modules/message-router/response-composer";
import { addMenuItemToDraftOrder, getOrCreateActiveDraftOrder } from "../../draft-orders/service";
import { extractExplicitConfigurationOptionTexts, isExplicitConfigurationSkip, resolveProductConfiguration, shouldPersistConfigurationSnapshot, splitConfigurationAnswerTexts, buildOrderLineItemOptionsSnapshot, type ProductConfigurationSource, type ProductConfigurationResolution } from "../../product-configurator/service";
import type { DetectedSignals } from "../../../modules/message-router/signal-detector";
import { sendAndLogText } from "../outbound/send";
import type { ConfigurableItemCandidate, PendingProductConfigurationContext } from "../shared/context";
import { loadCurrentMenu } from "../shared/helpers";
import { moveToManual } from "../manual/handoff";
import { continueAfterItemAdded, proceedToNextOrderStep } from "../checkout";
import type { RouteInboundMessageInput } from "../shared/types";
import { stageConfiguredItemSelection } from "./selection";

export async function tryHandlePendingProductConfiguration(
  input: RouteInboundMessageInput,
  payload?: {
    semanticAnswer?: {
      optionTexts?: OrderLineItemOptionTextInput[];
      notes?: string[];
      confidence?: number;
    } | null;
    signals?: DetectedSignals;
  },
): Promise<boolean> {
  const menu = await loadCurrentMenu(input);
  const pending = readPendingProductConfiguration(input.conversation);
  if (!pending) {
    return false;
  }

  const selectedItem = menu.items.find((item) => item.id === pending.menuItemId);
  if (!selectedItem) {
    await moveToManual(input, {
      type: "validation_failed_repeatedly",
      manualReason: "pending_product_configuration_missing_menu_item",
      title: "Configuracion pendiente sin producto",
      description: "El producto pendiente por configurar ya no pudo resolverse en el menu actual.",
      responseText: buildManualHandoffMessage(),
    });
    return true;
  }

  const option = selectedItem.product?.options?.find((entry) => entry.id === pending.pendingOptionId);
  if (!option) {
    await moveToManual(input, {
      type: "validation_failed_repeatedly",
      manualReason: "pending_product_configuration_missing_option",
      title: "Configuracion pendiente sin opcion",
      description: "La opcion pendiente por configurar ya no existe o no pudo cargarse.",
      responseText: buildManualHandoffMessage(),
    });
    return true;
  }

  const answerText = input.message.text?.trim() ?? "";
  const explicitOptionTexts = extractExplicitConfigurationOptionTexts(selectedItem, answerText);
  const numericOptionTexts = mapConfigurationAnswerToRawOptionTexts(
    option,
    splitConfigurationAnswerTexts(answerText).filter((entry) => /^\d+$/.test(entry)).join(", "),
  );
  const rawOptionTexts = payload?.semanticAnswer?.optionTexts?.length
    ? payload.semanticAnswer.optionTexts
    : explicitOptionTexts.length > 0
      ? uniqueRawOptionTexts([...numericOptionTexts, ...explicitOptionTexts])
      : mapConfigurationAnswerToRawOptionTexts(option, answerText);
  const isExplicitSkip = isExplicitConfigurationSkip(option, answerText);
  if (rawOptionTexts.length === 0 && !isExplicitSkip) {
    return false;
  }

  // If the previous answer exceeded a maximum, a new answer to that same
  // group replaces the invalid selection instead of accumulating over it.
  const retryingInvalidOption = (pending.invalidValueTexts ?? []).some((entry) => normalizeComparableText(entry) === normalizeComparableText(option.name));
  const existingResolvedOptions = retryingInvalidOption
    ? pending.resolvedOptions.filter((entry) => entry.optionId !== option.id)
    : pending.resolvedOptions;
  const existingRawOptionTexts = retryingInvalidOption
    ? pending.rawOptionTexts.filter((entry) => normalizeComparableText(entry.groupText ?? "") !== normalizeComparableText(option.name))
    : pending.rawOptionTexts;
  const skippedOptionIds = new Set(pending.skippedOptionIds ?? []);
  if (isExplicitSkip && option.id) {
    skippedOptionIds.add(option.id);
  }

  const resolution = resolveProductConfiguration({
    menuItem: selectedItem,
    source: pending.source,
    rawOptionTexts,
    freeTextNotes: pending.notes,
    existingResolvedOptions,
    skippedOptionIds: Array.from(skippedOptionIds),
    // Explicitly named values can span several component groups in one text.
    forcedOptionId: explicitOptionTexts.length > 0 ? undefined : option.id,
  });

  const mergedRawOptionTexts = [...existingRawOptionTexts, ...rawOptionTexts];

  if (resolution.status === "resolved") {
    const notes = uniqueNotes([...pending.notes, ...resolution.freeTextNotes, ...(payload?.semanticAnswer?.notes ?? [])]);
    let draft = await addSelectedItem(input, {
      menu,
      selectedItem,
      quantity: pending.quantity,
      options: shouldPersistConfigurationSnapshot({
        menuItem: selectedItem,
        resolution,
      })
        ? buildOrderLineItemOptionsSnapshot({
            ...resolution,
            rawOptionTexts: mergedRawOptionTexts,
            freeTextNotes: notes,
          })
        : undefined,
      notes: notes.join("; ") || undefined,
      unitPrice: resolution.pricing.resolvedUnitPrice,
    });

    let lastSelectedItem = selectedItem;
    const queuedResult = await processQueuedConfiguredItems(input, {
      menu,
      queuedItems: pending.queuedItems ?? [],
    });
    if (queuedResult.kind === "prompted") {
      return true;
    }
    if (queuedResult.kind === "added") {
      draft = queuedResult.draft ?? draft;
      lastSelectedItem = queuedResult.lastSelectedItem ?? lastSelectedItem;
    }

    if (pending.returnToOrderAdjustment) {
      await proceedToNextOrderStep(input, { menu, draft });
      return true;
    }

    await continueAfterItemAdded(input, {
      menu,
      draft,
      selectedItem: lastSelectedItem,
      quantity: pending.quantity,
      signals: {
        fulfillmentType: payload?.signals?.fulfillmentType ?? null,
        paymentMethod: payload?.signals?.paymentMethod ?? null,
      },
    });
    return true;
  }

  if (resolution.status === "needs_clarification" && resolution.nextOption?.id) {
    await persistPendingProductConfiguration(input, {
      menu,
      selectedItem,
      quantity: pending.quantity,
      source: pending.source,
      rawItemText: pending.rawItemText,
      rawOptionTexts: mergedRawOptionTexts,
      notes: uniqueNotes([...pending.notes, ...resolution.freeTextNotes]),
      resolution,
      queuedItems: pending.queuedItems,
    });
    return true;
  }

  await moveToManual(input, {
    type: "validation_failed_repeatedly",
    manualReason: "product_configuration_unresolved",
    title: "Producto requiere configuracion manual",
    description: "El bot no logro completar la configuracion del producto despues de varios intentos.",
    responseText: buildManualHandoffMessage(),
  });
  return true;
}

export async function persistPendingProductConfiguration(input: RouteInboundMessageInput, payload: {
  menu: TodayMenuPayload;
  selectedItem: MenuItem;
  quantity: number;
  source: ProductConfigurationSource;
  rawItemText?: string;
  rawOptionTexts: OrderLineItemOptionTextInput[];
  notes: string[];
  resolution: ProductConfigurationResolution;
  queuedItems?: ConfigurableItemCandidate[];
}): Promise<void> {
  const nextOption = payload.resolution.nextOption;
  if (!nextOption?.id) {
    throw new Error("product_configuration.next_option_missing");
  }

  await updateConversationStateForRoute(input, {
    state: "awaiting_product_configuration",
    context: {
      ...input.conversation.context,
      pendingConfig: {
        id: crypto.randomUUID(),
        menuItemId: payload.selectedItem.id,
        productId: payload.selectedItem.productId ?? payload.selectedItem.product?.id,
        quantity: payload.quantity,
        source: payload.source,
        rawItemText: payload.rawItemText,
        rawOptionTexts: payload.rawOptionTexts,
        notes: payload.notes,
        resolvedOptions: payload.resolution.resolvedOptions,
        pendingOptionId: nextOption.id,
        pendingOptionName: nextOption.name,
        pendingOptionType: nextOption.type,
        invalidValueTexts: payload.resolution.invalidValueTexts,
        ambiguousValueTexts: payload.resolution.ambiguousValueTexts,
        skippedOptionIds: payload.resolution.skippedOptionIds,
        startedAt: new Date().toISOString(),
        queuedItems: payload.queuedItems,
        returnToOrderAdjustment: input.conversation.state === "awaiting_order_adjustment",
      } satisfies PendingProductConfigurationContext,
    },
    resetClarificationAttempts: true,
  });

  await sendAndLogText(
    input,
    buildProductConfigurationPrompt(
      payload.selectedItem.displayName ?? payload.selectedItem.product?.name ?? "tu producto",
      nextOption,
      {
        invalidValueTexts: payload.resolution.invalidValueTexts,
        ambiguousValueTexts: payload.resolution.ambiguousValueTexts,
      },
    ),
  );
}

export function readPendingProductConfiguration(conversation: Conversation): PendingProductConfigurationContext | null {
  const candidate = conversation.context?.pendingConfig;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const pending = candidate as Partial<PendingProductConfigurationContext>;
  if (!pending.menuItemId || !pending.pendingOptionId || !pending.source) {
    return null;
  }

  return {
    id: pending.id ?? crypto.randomUUID(),
    menuItemId: pending.menuItemId,
    productId: pending.productId,
    quantity: Math.max(1, Math.round(pending.quantity ?? 1)),
    source: pending.source,
    rawItemText: pending.rawItemText,
    rawOptionTexts: Array.isArray(pending.rawOptionTexts) ? pending.rawOptionTexts : [],
    notes: Array.isArray(pending.notes) ? pending.notes.filter((entry): entry is string => typeof entry === "string") : [],
    resolvedOptions: Array.isArray(pending.resolvedOptions) ? pending.resolvedOptions : [],
    skippedOptionIds: Array.isArray(pending.skippedOptionIds) ? pending.skippedOptionIds.filter((entry): entry is string => typeof entry === "string") : undefined,
    pendingOptionId: pending.pendingOptionId,
    pendingOptionName: pending.pendingOptionName ?? "",
    pendingOptionType: pending.pendingOptionType ?? "single",
    invalidValueTexts: Array.isArray(pending.invalidValueTexts) ? pending.invalidValueTexts.filter((entry): entry is string => typeof entry === "string") : undefined,
    ambiguousValueTexts: Array.isArray(pending.ambiguousValueTexts) ? pending.ambiguousValueTexts.filter((entry): entry is string => typeof entry === "string") : undefined,
    startedAt: pending.startedAt ?? new Date().toISOString(),
    queuedItems: Array.isArray(pending.queuedItems) ? pending.queuedItems : undefined,
  };
}

function mapConfigurationAnswerToRawOptionTexts(option: ProductOption, answerText: string): OrderLineItemOptionTextInput[] {
  const normalized = answerText.trim();
  if (!normalized) {
    return [];
  }

  if (option.type === "text") {
    return [{ groupText: option.name, valueText: normalized }];
  }

  const activeValues = option.values.filter((value) => value.isActive);
  return splitConfigurationAnswerTexts(normalized).map((entry) => {
    const numeric = Number(entry);
    const selectedByIndex =
      Number.isInteger(numeric) && numeric >= 1 && numeric <= activeValues.length
        ? activeValues[numeric - 1]?.name
        : undefined;

    return {
      groupText: option.name,
      valueText: selectedByIndex ?? entry,
    };
  });
}

async function processQueuedConfiguredItems(input: RouteInboundMessageInput, payload: {
  menu: TodayMenuPayload;
  queuedItems: ConfigurableItemCandidate[];
}): Promise<{ kind: "added"; draft?: DraftOrder; lastSelectedItem?: MenuItem } | { kind: "prompted" }> {
  let latestDraft: DraftOrder | undefined;
  let lastSelectedItem: MenuItem | undefined;

  for (const [index, candidate] of payload.queuedItems.entries()) {
    const selectedItem = payload.menu.items.find((item) => item.id === candidate.menuItemId);
    if (!selectedItem) {
      continue;
    }

    const stageResult = await stageConfiguredItemSelection(input, {
      menu: payload.menu,
      selectedItem,
      quantity: candidate.quantity,
      source: candidate.source,
      rawItemText: candidate.rawItemText,
      rawOptionTexts: candidate.rawOptionTexts,
      notes: candidate.notes,
      queuedItems: payload.queuedItems.slice(index + 1),
    });
    if (stageResult.kind === "prompted") {
      return { kind: "prompted" };
    }

    latestDraft = stageResult.draft;
    lastSelectedItem = selectedItem;
  }

  return { kind: "added", draft: latestDraft, lastSelectedItem };
}

async function addSelectedItem(input: RouteInboundMessageInput, payload: {
  menu: TodayMenuPayload;
  selectedItem: MenuItem;
  quantity: number;
  options?: ReturnType<typeof buildOrderLineItemOptionsSnapshot>;
  notes?: string;
  unitPrice?: number;
}): Promise<DraftOrder> {
  const draft = await getOrCreateActiveDraftOrder({
    env: input.env,
    schemaName: input.tenant.schemaName,
    conversation: input.conversation,
    customerId: input.conversation.customerId,
    locationId: payload.menu.location?.id,
    deliveryFeeFixed: payload.menu.location?.deliveryFeeFixed,
  });

  return addMenuItemToDraftOrder({
    env: input.env,
    schemaName: input.tenant.schemaName,
    draftOrderId: draft.id,
    menuItem: payload.selectedItem,
    quantity: payload.quantity,
    options: payload.options,
    notes: payload.notes,
    unitPrice: payload.unitPrice,
    deliveryFeeFixed: payload.menu.location?.deliveryFeeFixed,
  });
}

function uniqueNotes(notes: string[]): string[] {
  return Array.from(new Set(notes.map((entry) => entry.trim()).filter(Boolean)));
}

function uniqueRawOptionTexts(entries: OrderLineItemOptionTextInput[]): OrderLineItemOptionTextInput[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${normalizeComparableText(entry.groupText ?? "")}::${normalizeComparableText(entry.valueText)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeComparableText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
