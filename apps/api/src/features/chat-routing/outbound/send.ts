import { logOutboundTextMessage } from "../../../modules/message-log/message-log";
import { sendWhatsAppTextMessage } from "../../../modules/whatsapp-webhook/whatsapp-client";
import { buildOutboundRoutingMetadata } from "../shared/tracing";
import type { RouteInboundMessageInput } from "../shared/types";
import { logEvent, safeErrorSummary } from "../../../lib/observability/logger.ts";

export async function sendAndLogText(input: RouteInboundMessageInput, text: string): Promise<void> {
  const metadata = buildOutboundRoutingMetadata(input);
  const result = await sendWhatsAppTextMessage(input.env, {
    to: input.message.from,
    text,
  }, {
    traceId: input.traceId,
    tenantId: input.tenant.id,
    conversationId: input.conversation.id,
  });

  await logOutboundTextMessage({
    env: input.env,
    schemaName: input.tenant.schemaName,
    conversationId: input.conversation.id,
    text,
    result,
    metadata,
  }).catch((error: unknown) => {
    logEvent("error", "message.outbound_log_failed", "No se pudo persistir el intento de mensaje saliente.", {
      environment: input.env.APP_ENV,
      traceId: input.traceId,
      tenantId: input.tenant.id,
      conversationId: input.conversation.id,
      error: safeErrorSummary(error),
    });
  });
}
