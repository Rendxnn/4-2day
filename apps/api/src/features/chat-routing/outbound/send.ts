import { logOutboundTextMessage } from "../../../modules/message-log/message-log";
import { sendWhatsAppTextMessage } from "../../../modules/whatsapp-webhook/whatsapp-client";
import { buildOutboundRoutingMetadata } from "../shared/tracing";
import type { RouteInboundMessageInput } from "../shared/types";
import type { OutboundDeliveryPort } from "../ports";
import { createHeadlessCapture } from "./capture";
import { logEvent, safeErrorSummary } from "../../../lib/observability/logger.ts";
import { recordHeadlessEffect } from "../shared/effects";

export async function sendAndLogText(input: RouteInboundMessageInput, text: string): Promise<string | undefined> {
  const metadata = buildOutboundRoutingMetadata(input);
  const delivery = input.delivery ?? (input.source === "headless"
    ? createHeadlessCapture({
        captureContext: input.captureContext ?? "turn",
        originatingTurnId: input.originatingTurnId ?? input.message.providerMessageId,
      })
    : createWhatsAppDelivery(input));
  const deliveryResult = await delivery.sendText({
    text,
    captureContext: input.source === "headless" ? (input.captureContext ?? "turn") : undefined,
    originatingTurnId: input.source === "headless" ? (input.originatingTurnId ?? input.message.providerMessageId) : undefined,
  });

  let messageId: string;
  try {
    messageId = await logOutboundTextMessage({
      env: input.env,
      schemaName: input.tenant.schemaName,
      conversationId: input.conversation.id,
      text,
      result: deliveryResult.result,
      metadata: {
        ...metadata,
        ...(input.source === "headless" ? { provider: "headless", deliveryStatus: "captured" } : {}),
        ...(input.source === "headless" ? { capture: deliveryResult.response } : {}),
      },
    });
  } catch (error: unknown) {
    logEvent("error", "message.outbound_log_failed", "No se pudo persistir el intento de mensaje saliente.", {
      environment: input.env.APP_ENV,
      traceId: input.traceId,
      tenantId: input.tenant.id,
      conversationId: input.conversation.id,
      error: safeErrorSummary(error),
    });
    if (input.source === "headless") {
      throw error;
    }
    return undefined;
  }

  if (input.source === "headless") {
    await recordHeadlessEffect(input, { type: "outbound_message", id: messageId, status: "captured" });
  }
  return messageId;
}

function createWhatsAppDelivery(input: RouteInboundMessageInput): OutboundDeliveryPort {
  return {
    async sendText(deliveryInput) {
      const result = await sendWhatsAppTextMessage(input.env, {
        to: input.message.from,
        text: deliveryInput.text,
      }, {
        traceId: input.traceId,
        tenantId: input.tenant.id,
        conversationId: input.conversation.id,
      });

      return { result };
    },
  };
}
