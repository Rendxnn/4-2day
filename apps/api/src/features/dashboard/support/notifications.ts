import type { OrderCustomerNotificationType } from "@42day/types";
import { createSupabaseRestClient } from "../../../lib/supabase-rest";
import type { ApiBindings } from "../../../lib/bindings";
import { logOutboundImageMessage, logOutboundTextMessage } from "../../../modules/message-log/message-log";
import { sendWhatsAppImageMessage, sendWhatsAppTextMessage } from "../../../modules/whatsapp-webhook/whatsapp-client";
import type { OrderCustomerNotificationPayload } from "../order-customer-notifications";
import type { LocationRow, OrderNotificationContext, OrderRow } from "../types";
import { formatCop } from "./date";

export function buildAcceptedOrderMessage(order: OrderRow, _location?: LocationRow): string {
  if (order.payment_method === "transfer") {
    return [
      `¡Gracias! Tu pedido ${order.id.slice(0, 8)} ya fue confirmado por el restaurante. 🙌`,
      "Puedes hacer la transferencia y, cuando la realices, envíame el comprobante por aquí para continuar con tu pedido.",
    ].join("\n\n");
  }

  return [
    `¡Gracias! Tu pedido ${order.id.slice(0, 8)} ya fue confirmado por el restaurante. 🙌`,
    "Ya lo estamos preparando. Si surge alguna novedad, te escribiré por aquí.",
  ].join("\n\n");
}

export function buildOutOfStockMessage(items: Array<{
  name: string;
  quantity?: number;
  suggestions?: Array<{ name: string; price?: number }>;
}>): string {
  const unavailableLines = items.map((item) => `• ${item.quantity ?? 1} x ${item.name}`);
  const suggestionLines = items.flatMap((item) => (item.suggestions ?? []).slice(0, 3).map(
    (option) => `• ${option.name}${option.price !== undefined ? ` — ${formatCop(option.price)}` : ""}`,
  ));

  return [
    `Lo siento mucho, en este momento no tenemos:\n${unavailableLines.join("\n")}`,
    suggestionLines.length > 0 ? `Como referencia, hoy también tenemos:\n${suggestionLines.join("\n")}` : null,
    "Puedes ajustar todo tu pedido por aquí. Por ejemplo: “cámbiame los productos agotados por un almuerzo del día y una carne a la plancha”, “déjame 3 cafés con leche” o “quita los jugos”.",
    'Cuando estés listo te mostraré el nuevo resumen para que lo confirmes. También puedes escribir "cancelar" o "asesor".',
  ].filter(Boolean).join("\n\n");
}

export function buildOrderStatusNotification(order: Pick<OrderRow, "status" | "fulfillment_type">): string | null {
  if (order.status === "preparing") {
    return "Tu pedido ya está siendo preparado por nuestro increíble chef. En cuanto esté listo, te avisaremos por aquí.";
  }

  if (order.status === "on_the_way") {
    return order.fulfillment_type === "delivery"
      ? "Tu pedido ya salió en camino a tu domicilio. Dentro de poco podrás disfrutarlo. ¡Gracias por la espera!"
      : "Tu pedido ya está listo para que lo recojas y lo disfrutes. ¡Te esperamos!";
  }

  if (order.status === "delivered") {
    return order.fulfillment_type === "delivery"
      ? "Tu pedido fue entregado. Esperamos que lo disfrutes. ¡Gracias por elegirnos!"
      : "Tu pedido fue finalizado. Esperamos que lo hayas disfrutado. ¡Gracias por elegirnos!";
  }

  if (order.status === "cancelled") {
    return "Tu pedido fue cancelado. Si necesitas ayuda, escríbenos por este chat.";
  }

  return null;
}

export function buildRetryNotificationMessage(
  type: OrderCustomerNotificationType,
  order: OrderRow,
  location?: LocationRow,
): string | null {
  if (type === "accepted") {
    return buildAcceptedOrderMessage(order, location);
  }

  if (type === "out_of_stock") {
    const metadata = order.restaurant_review_metadata ?? {};
    const unavailableItems = Array.isArray(metadata.unavailableItems) ? metadata.unavailableItems : [];
    const replacementMenuItemsByUnavailableItem = metadata.replacementMenuItemsByUnavailableItem && typeof metadata.replacementMenuItemsByUnavailableItem === "object"
      ? metadata.replacementMenuItemsByUnavailableItem as Record<string, unknown>
      : {};
    const items = unavailableItems.flatMap((item) => {
      if (!item || typeof item !== "object" || !("name" in item) || !item.name) return [];
      const orderItemId = "orderItemId" in item ? String(item.orderItemId) : "";
      const suggestions = Array.isArray(replacementMenuItemsByUnavailableItem[orderItemId])
        ? replacementMenuItemsByUnavailableItem[orderItemId]
            .filter((option): option is Record<string, unknown> => Boolean(option) && typeof option === "object" && "name" in option)
            .map((option) => ({ name: String(option.name), price: option.price !== undefined ? Number(option.price) : undefined }))
        : [];
      return [{ name: String(item.name), quantity: "quantity" in item ? Number(item.quantity) : 1, suggestions }];
    });

    if (items.length === 0) {
      return null;
    }

    return buildOutOfStockMessage(items);
  }

  if (type === "order_status") {
    return buildOrderStatusNotification(order);
  }

  return null;
}

export async function sendOrderCustomerNotification(input: {
  env: ApiBindings;
  schemaName: string;
  context: OrderNotificationContext;
  notification: OrderCustomerNotificationPayload;
  notificationType: OrderCustomerNotificationType;
}): Promise<OrderRow> {
  const traceId = `PHN-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const logContext = {
    traceId,
    conversationId: input.context.draftOrder?.conversation_id ?? undefined,
  };
  const result = input.notification.kind === "image"
    ? await sendWhatsAppImageMessage(input.env, {
        to: input.context.customer.phone,
        imageUrl: input.notification.imageUrl,
        caption: input.notification.caption,
      }, logContext)
    : await sendWhatsAppTextMessage(input.env, {
        to: input.context.customer.phone,
        text: input.notification.text,
      }, logContext);
  const now = new Date().toISOString();
  const notificationSent = result.ok && Boolean(result.providerMessageId);
  const notificationStatus = notificationSent ? "sent" : "failed";
  const notificationError = notificationSent
    ? null
    : buildNotificationFailureCode(input.notificationType, result.error?.code);
  const [updatedOrder] = await createSupabaseRestClient(input.env).updateReturning<OrderRow>({
    schema: input.schemaName,
    table: "orders",
    query: {
      id: `eq.${input.context.order.id}`,
    },
    patch: {
      customer_notified_at: notificationSent ? now : null,
      customer_notification_status: notificationStatus,
      customer_notification_error: notificationError,
      updated_at: now,
    },
  });

  if (input.context.draftOrder?.conversation_id) {
    const metadata = {
      order: {
        orderId: input.context.order.id,
        notificationType: input.notificationType,
        source: "dashboard_api",
        traceId,
      },
    };
    await (input.notification.kind === "image"
      ? logOutboundImageMessage({
          env: input.env,
          schemaName: input.schemaName,
          conversationId: input.context.draftOrder.conversation_id,
          caption: input.notification.caption,
          result,
          metadata: {
            ...metadata,
            imageUrl: input.notification.imageUrl,
          },
        })
      : logOutboundTextMessage({
          env: input.env,
          schemaName: input.schemaName,
          conversationId: input.context.draftOrder.conversation_id,
          text: input.notification.text,
          result,
          metadata,
        })).catch(() => undefined);
  }

  await createSupabaseRestClient(input.env).insert({
    schema: input.schemaName,
    table: "app_events",
    rows: {
      conversation_id: input.context.draftOrder?.conversation_id ?? null,
      draft_order_id: input.context.order.draft_order_id ?? null,
      order_id: input.context.order.id,
      event_name: notificationSent ? "whatsapp.customer_notification_sent" : "whatsapp.customer_notification_failed",
      severity: notificationSent ? "info" : "warn",
      source: "dashboard_api",
      metadata: {
        traceId,
        notificationType: input.notificationType,
        providerMessageId: result.providerMessageId ?? null,
        httpStatus: result.httpStatus,
        error: result.error ?? null,
      },
    },
  }).catch(() => undefined);

  return updatedOrder ?? input.context.order;
}

function buildNotificationFailureCode(
  notificationType: OrderCustomerNotificationType,
  providerCode: string | number | undefined,
): string {
  const safeProviderCode = typeof providerCode === "string" || typeof providerCode === "number"
    ? `_meta_${String(providerCode).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32)}`
    : "";
  return `notification_${notificationType}_failed${safeProviderCode}`;
}
