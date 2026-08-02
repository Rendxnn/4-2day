import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../../../supabase/migrations/20260717071518_semantic_draft_operation_plan.sql", import.meta.url);
const semanticOrderPath = new URL("../src/features/chat-routing/semantic/order.ts", import.meta.url);
const operationPlanPath = new URL("../src/features/chat-routing/semantic/operation-plan.ts", import.meta.url);
const outOfStockRoutePath = new URL("../src/features/dashboard/routes/orders/out-of-stock.ts", import.meta.url);
const notificationsPath = new URL("../src/features/dashboard/support/notifications.ts", import.meta.url);
const tracingPath = new URL("../src/features/chat-routing/shared/tracing.ts", import.meta.url);
const dashboardPath = new URL("../../dashboard/src/orders.tsx", import.meta.url);

test("the out-of-stock prompt groups every unavailable item and uses natural-language adjustments", async () => {
  const source = await readFile(notificationsPath, "utf8");
  assert.match(source, /items\.map\(\(item\) => `• \$\{item\.quantity/);
  assert.match(source, /cámbiame los productos agotados/);
  assert.doesNotMatch(source, /número de la opción que prefieras/);
});

test("semantic adjustment uses exact draft lines and preserves the unavailable quantity only for one implicit replacement", async () => {
  const source = await readFile(semanticOrderPath, "utf8");
  assert.match(source, /state === "awaiting_order_adjustment"/);
  assert.match(source, /remove_draft_line/);
  assert.match(source, /findExactDraftLine/);
  assert.match(source, /inferProductQuantity/);
  assert.match(source, /additions\.length === 1 && unavailable\.length === 1/);
  assert.match(source, /state: "awaiting_confirmation"/);
  assert.match(source, /consolidateOrderLineItems\(items\)/);
});

test("semantic confirmation sends one final summary instead of snapshot plus summary", async () => {
  const source = await readFile(semanticOrderPath, "utf8");
  const confirmationBranch = source.slice(
    source.indexOf('if (next.state === "awaiting_confirmation")'),
    source.indexOf('const snapshot = buildOrderProgressSnapshot(draft)', source.indexOf('if (next.state === "awaiting_confirmation")')),
  );

  assert.match(confirmationBranch, /sendAndLogText\(input, buildOrderSummaryText/);
  assert.match(confirmationBranch, /return;/);
  assert.doesNotMatch(source, /case "awaiting_confirmation": prompt =/);
});

test("restaurant out-of-stock reporting persists all affected lines instead of only the first", async () => {
  const source = await readFile(outOfStockRoutePath, "utf8");
  assert.match(source, /const selections = body\.items\.map/);
  assert.match(source, /replacementMenuItemsByUnavailableItem/);
  assert.match(source, /state: "awaiting_order_adjustment"/);
});

test("the semantic plan RPC locks, validates availability, and synchronizes the revised draft atomically", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /apply_semantic_draft_operation_plan/);
  assert.match(migration, /for update/);
  assert.match(migration, /conversation_stale/);
  assert.match(migration, /draft_order_stale/);
  assert.match(migration, /jsonb_array_elements\(p_items\)/);
  assert.match(migration, /delete from %1\$I\.draft_order_items/);
  assert.match(migration, /insert into %1\$I\.draft_order_items/);
  assert.match(migration, /ready_for_confirmation/);
  assert.match(migration, /configure_new_tenant_semantic_draft_operation_plan/);
});

test("semantic operation plans expose only ID-based operations and do not fall back to fuzzy item matching", async () => {
  const source = await readFile(operationPlanPath, "utf8");
  const semanticOrder = await readFile(semanticOrderPath, "utf8");
  assert.match(source, /menuItemId/);
  assert.match(source, /draftOrderItemId/);
  assert.match(source, /additionalProperties: false/);
  assert.doesNotMatch(source, /productText/);
  assert.doesNotMatch(semanticOrder, /resolveMenuSelectionFromText/);
  assert.match(semanticOrder, /semantic_operation_plan_provider_failure/);
});

test("semantic control decisions are explicit and limited to their checkout states", async () => {
  const source = await readFile(operationPlanPath, "utf8");
  const orderSource = await readFile(semanticOrderPath, "utf8");

  assert.match(source, /reuse_billing_profile/);
  assert.match(source, /change_billing/);
  assert.match(source, /switch_to_electronic_billing/);
  assert.match(source, /edit_order/);
  assert.match(source, /accept_cash_fallback/);
  assert.match(source, /keep_transfer/);
  assert.match(source, /state === "awaiting_billing_reuse_confirmation"/);
  assert.match(source, /state === "awaiting_confirmation"/);
  assert.match(source, /state === "awaiting_transfer_fallback_payment_method"/);
  assert.match(orderSource, /tryHandleBillingReuseConfirmation/);
  assert.match(orderSource, /tryHandleTransferFallbackPaymentMethod/);
  assert.match(orderSource, /tryHandleConfirmation\(input, \{ confirmation: "change" \}\)/);
});

test("semantic written addresses require coverage and report its outcome without logging address contents", async () => {
  const orderSource = await readFile(semanticOrderPath, "utf8");

  assert.match(orderSource, /semantic_delivery_address\.coverage_evaluated/);
  assert.match(orderSource, /coverageOutcome: "inside"/);
  assert.match(orderSource, /\? "outside_allowed" : "outside"/);
  assert.match(orderSource, /coverageOutcome: "unresolved"/);
  assert.match(orderSource, /coverageOutcome: "provider_error"/);
  assert.match(orderSource, /validamos tu dirección y está dentro de cobertura/);
  assert.match(orderSource, /No tenemos cobertura para esa dirección/);
  assert.match(orderSource, /No pude validar esa dirección todavía/);
  const coverageLog = orderSource.slice(
    orderSource.indexOf('logRoutingDiagnostic(input, "semantic_delivery_address.coverage_evaluated"'),
    orderSource.indexOf('logRoutingDiagnostic(input, "semantic_delivery_address.coverage_evaluated"') + 300,
  );
  assert.doesNotMatch(coverageLog, /address(Text|Details)/);
});

test("a pending product configuration stays in the ID-based semantic context until it is completed", async () => {
  const planSource = await readFile(operationPlanPath, "utf8");
  const orderSource = await readFile(semanticOrderPath, "utf8");
  assert.match(planSource, /pendingConfiguration/);
  assert.match(planSource, /awaiting_product_configuration/);
  assert.match(orderSource, /readPendingProductConfiguration/);
  assert.match(orderSource, /toSemanticConfigurationSelections/);
  assert.match(orderSource, /contextAfterSemanticPlan/);
});

test("routing diagnostics emit structured events for the semantic plan and its transaction outcome", async () => {
  const tracing = await readFile(tracingPath, "utf8");
  const semanticOrder = await readFile(semanticOrderPath, "utf8");
  assert.match(tracing, /logEvent\(level, event/);
  assert.doesNotMatch(tracing, /console\.info\(JSON\.stringify/);
  assert.match(semanticOrder, /semantic_operation_plan\.completed/);
  assert.match(semanticOrder, /semantic_operation_plan\.applied/);
  assert.match(semanticOrder, /semantic_operation_plan\.transaction_failed/);
  assert.match(semanticOrder, /semanticOperationPlanFailureDiagnostics/);
  assert.match(semanticOrder, /handleSemanticProviderFailure/);
});

test("dashboard notifications distinguish an accepted order from a failed WhatsApp delivery", async () => {
  const notifications = await readFile(notificationsPath, "utf8");
  const dashboard = await readFile(dashboardPath, "utf8");

  assert.match(notifications, /const notificationSent = result\.ok && Boolean\(result\.providerMessageId\)/);
  assert.match(notifications, /customer_notification_error: notificationError/);
  assert.match(notifications, /httpStatus: result\.httpStatus/);
  assert.match(notifications, /error: result\.error \?\? null/);
  assert.match(dashboard, /Pedido confirmado, pero WhatsApp no pudo notificar al cliente/);
  assert.match(dashboard, /WhatsApp rechazó el reintento/);
});
