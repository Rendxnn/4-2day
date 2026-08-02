import type { HumanInterventionType } from "@42day/types";
import { incrementClarificationAttempts, pauseConversationAutomation } from "../../conversations/service";
import { persistHumanInterventionAlert } from "../../../modules/handoff-service/handoff-service";
import { sendAndLogText } from "../outbound/send";
import { buildMaxClarificationMessage } from "../../../modules/message-router/response-composer";
import type { RouteInboundMessageInput } from "../shared/types";
import { logEvent, safeErrorSummary } from "../../../lib/observability/logger.ts";

export async function handleClarification(
  input: RouteInboundMessageInput,
  responseText: string,
  manualReason: string,
): Promise<void> {
  if (input.conversation.clarificationAttempts >= 2) {
    await moveToManual(input, {
      type: "validation_failed_repeatedly",
      manualReason,
      title: "Conversacion necesita ayuda",
      description: "El bot no logro resolver la conversacion despues de varios intentos.",
      responseText: buildMaxClarificationMessage(),
    });
    return;
  }

  await incrementClarificationAttempts({
    env: input.env,
    schemaName: input.tenant.schemaName,
    conversationId: input.conversation.id,
  }).catch(() => undefined);

  await sendAndLogText(input, responseText);
}

export async function moveToManual(input: RouteInboundMessageInput, payload: {
  type: HumanInterventionType;
  manualReason: string;
  title: string;
  description: string;
  responseText: string;
  orderId?: string;
  draftOrderId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await pauseConversationAutomation({
    env: input.env,
    schemaName: input.tenant.schemaName,
    conversation: input.conversation,
    manualReason: payload.manualReason,
  }).catch(() => undefined);

  await persistHumanInterventionAlert({
    env: input.env,
    schemaName: input.tenant.schemaName,
    alert: {
      conversationId: input.conversation.id,
      draftOrderId: payload.draftOrderId,
      orderId: payload.orderId,
      type: payload.type,
      title: payload.title,
      description: payload.description,
      metadata: {
        providerMessageId: input.message.providerMessageId,
        ...(payload.metadata ?? {}),
      },
    },
  }).catch((error: unknown) => {
    logEvent("error", "handoff.alert_create_failed", "No se pudo crear la alerta de intervención humana.", {
      environment: input.env.APP_ENV,
      traceId: input.traceId,
      tenantId: input.tenant.id,
      conversationId: input.conversation.id,
      error: safeErrorSummary(error),
    });
  });

  await sendAndLogText(input, payload.responseText);
}
