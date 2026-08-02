import type { NormalizedInboundMessage } from "@42day/types";
import type { ApiBindings } from "../../lib/bindings";
import { loadOrCreateActiveConversation } from "../conversation-service/conversation-service";
import { saveCustomerAddressFromWhatsAppLocation } from "../customer-address-service/customer-address-service";
import { findOrCreateCustomer } from "../customer-service/customer-service";
import { logInboundMessage, logOutboundTextMessage } from "../message-log/message-log";
import { routeInboundMessage, type RouteInboundMessageInput } from "../message-router/router";
import { resolveTenantForInboundMessage } from "../tenant-resolver/tenant-resolver";
import { normalizeWhatsAppPayload } from "./normalize";
import { logRawWhatsAppWebhook, markRawWhatsAppWebhookFailed, markRawWhatsAppWebhookProcessed } from "./webhook-event-log";
import { transcribeWhatsAppAudio } from "../audio-transcription/audio-transcription";
import { sendWhatsAppTextMessage } from "./whatsapp-client";
import { logEvent, safeErrorSummary } from "../../lib/observability/logger.ts";

export type HandleWhatsAppWebhookInput = {
  env: ApiBindings;
  payload: unknown;
};

export async function handleWhatsAppWebhook(input: HandleWhatsAppWebhookInput): Promise<void> {
  const startedAt = Date.now();
  const summary = summarizeWhatsAppWebhook(input.payload);
  logEvent("info", "whatsapp.webhook.received", describeWebhookSummary(summary), {
    environment: input.env.APP_ENV,
    ...summary,
  });

  const rawLogStatus = await logRawWhatsAppWebhook(input.env, input.payload);

  if (rawLogStatus.status === "duplicate") {
    logEvent(
      rawLogStatus.duplicateReason === "previously_failed" ? "warn" : "info",
      "whatsapp.webhook.duplicate_ignored",
      rawLogStatus.duplicateReason === "previously_failed"
        ? "El webhook falló previamente y no se reprocesó para evitar duplicar operaciones."
        : "El webhook ya estaba procesado o continúa en ejecución.",
      {
        environment: input.env.APP_ENV,
        duplicateReason: rawLogStatus.duplicateReason,
        ...summary,
      },
    );
    return;
  }

  try {
    const messages = normalizeWhatsAppPayload(input.payload);

    if (messages.length === 0) {
      const event = summary.statusCount > 0
        ? "whatsapp.status.received"
        : summary.providerErrorCount > 0
          ? "whatsapp.provider_error.received"
          : "whatsapp.webhook.no_actionable_messages";
      const message = summary.statusCount > 0
        ? "Meta reportó cambios de estado para mensajes salientes."
        : summary.providerErrorCount > 0
          ? "Meta reportó errores relacionados con WhatsApp."
          : "El webhook no contiene mensajes entrantes procesables.";
      logEvent(summary.providerErrorCount > 0 ? "warn" : "info", event, message, {
        environment: input.env.APP_ENV,
        webhookEventId: rawLogStatus.webhookEventId,
        ...summary,
      });
      await markRawWhatsAppWebhookProcessed(input.env, rawLogStatus.webhookEventId);
      return;
    }

    for (const message of messages) {
      await handleInboundMessage(input.env, message);
    }

    await markRawWhatsAppWebhookProcessed(input.env, rawLogStatus.webhookEventId);
    logEvent("info", "whatsapp.webhook.processed", "El webhook terminó correctamente.", {
      environment: input.env.APP_ENV,
      webhookEventId: rawLogStatus.webhookEventId,
      messageCount: messages.length,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    const safeError = safeErrorSummary(error);
    await markRawWhatsAppWebhookFailed(input.env, rawLogStatus.webhookEventId, `${safeError.name}:${safeError.safeDetail}`)
      .catch((markError: unknown) => {
        logEvent("error", "whatsapp.webhook.failure_persist_failed", "No se pudo marcar el webhook como fallido.", {
          environment: input.env.APP_ENV,
          webhookEventId: rawLogStatus.webhookEventId,
          error: safeErrorSummary(markError),
        });
      });
    logEvent("error", "whatsapp.webhook.processing_failed", "El webhook terminó con un error antes de completar el procesamiento.", {
      environment: input.env.APP_ENV,
      webhookEventId: rawLogStatus.webhookEventId,
      durationMs: Date.now() - startedAt,
      error: safeError,
    });
    throw error;
  }
}

async function handleInboundMessage(env: ApiBindings, message: NormalizedInboundMessage): Promise<void> {
  const startedAt = Date.now();
  const traceId = `PH-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  let stage = "tenant_resolution";
  let tenantId: string | undefined;
  let conversationId: string | undefined;

  logEvent("info", "whatsapp.inbound.normalized", "El mensaje entrante fue normalizado.", {
    environment: env.APP_ENV,
    traceId,
    providerMessageId: message.providerMessageId,
    messageType: message.type,
    hasText: Boolean(message.text?.trim()),
    textLength: message.text?.trim().length ?? 0,
  });

  try {
    const tenant = await resolveTenantForInboundMessage(env, message);

    if (!tenant) {
      logEvent("warn", "tenant.not_found", "No se encontró un tenant para el número receptor de WhatsApp.", {
        environment: env.APP_ENV,
        traceId,
        providerMessageId: message.providerMessageId,
      });
      return;
    }
    tenantId = tenant.id;

    stage = "customer_resolution";
    const customer = await findOrCreateCustomer({
      env,
      schemaName: tenant.schemaName,
      phone: message.from,
    });

    stage = "conversation_resolution";
    const conversation = await loadOrCreateActiveConversation({
      env,
      schemaName: tenant.schemaName,
      customerId: customer.id,
    });
    conversationId = conversation.id;

    let routedMessage = message;
    if (message.type === "audio") {
      stage = "audio_transcription";
      if (!message.mediaId) {
        await logInboundMessage({
          env,
          schemaName: tenant.schemaName,
          conversationId: conversation.id,
          message,
        }).catch((error: unknown) => {
          logEvent("error", "message.inbound_log_failed", "No se pudo persistir el audio entrante.", {
            environment: env.APP_ENV,
            traceId,
            tenantId,
            conversationId,
            error: safeErrorSummary(error),
          });
        });
        await sendAudioTranscriptionFailure(env, tenant.schemaName, conversation.id, message.from, "No recibí el archivo de audio completo. Por favor envíame el audio otra vez o escríbeme tu mensaje.", traceId);
        return;
      }

      try {
        const transcription = await transcribeWhatsAppAudio({
          env,
          mediaId: message.mediaId,
          mimeType: message.mediaMimeType,
        });
        routedMessage = {
          ...message,
          text: transcription,
          raw: {
            original: message.raw,
            transcription: {
              provider: env.AUDIO_TRANSCRIPTION_PROVIDER?.trim() || (env.OPENAI_API_KEY?.trim() ? "openai" : "huggingface"),
              model: env.AUDIO_TRANSCRIPTION_PROVIDER === "huggingface"
                ? env.HUGGINGFACE_TRANSCRIPTION_MODEL?.trim() || "openai/whisper-large-v3-turbo"
                : env.OPENAI_TRANSCRIPTION_MODEL?.trim() || "whisper-1",
              text: transcription,
            },
          },
        };
      } catch (error) {
        logEvent("warn", "whatsapp.audio_transcription_failed", "No se pudo transcribir el audio entrante.", {
          environment: env.APP_ENV,
          traceId,
          tenantId,
          conversationId,
          providerMessageId: message.providerMessageId,
          error: safeErrorSummary(error),
        });
        await logInboundMessage({
          env,
          schemaName: tenant.schemaName,
          conversationId: conversation.id,
          message,
        }).catch((logError: unknown) => {
          logEvent("error", "message.inbound_log_failed", "No se pudo persistir el audio que falló durante la transcripción.", {
            environment: env.APP_ENV,
            traceId,
            tenantId,
            conversationId,
            error: safeErrorSummary(logError),
          });
        });
        await sendAudioTranscriptionFailure(env, tenant.schemaName, conversation.id, message.from, "No pude entender el audio en este momento. Por favor repítelo o escríbeme lo que necesitas.", traceId);
        return;
      }
    }

    stage = "inbound_message_persistence";
    const loggedMessage = await logInboundMessage({
      env,
      schemaName: tenant.schemaName,
      conversationId: conversation.id,
      message: routedMessage,
    });

    stage = "location_persistence";
    await saveCustomerAddressFromWhatsAppLocation({
      env,
      schemaName: tenant.schemaName,
      customerId: customer.id,
      message: routedMessage,
    });

    stage = "message_routing";
    const routeInput: RouteInboundMessageInput = {
      env,
      tenant,
      conversation,
      message: routedMessage,
      traceId,
      loggedMessageId: loggedMessage.id,
    };
    await routeInboundMessage(routeInput);
    logEvent("info", "message.processing.completed", "El mensaje entrante terminó su procesamiento.", {
      environment: env.APP_ENV,
      traceId,
      tenantId,
      conversationId,
      durationMs: Date.now() - startedAt,
      responseSource: routeInput.routingTrace?.responseSource,
      responseReason: routeInput.routingTrace?.responseReason,
      llmOutcome: routeInput.routingTrace?.llm?.outcome,
      llmProvider: routeInput.routingTrace?.llm?.provider,
    });
  } catch (error) {
    logEvent("error", "message.processing.failed", "El mensaje entrante terminó con un error no recuperado.", {
      environment: env.APP_ENV,
      traceId,
      tenantId,
      conversationId,
      failedStage: stage,
      durationMs: Date.now() - startedAt,
      error: safeErrorSummary(error),
    });
    throw error;
  }
}

async function sendAudioTranscriptionFailure(
  env: ApiBindings,
  schemaName: string,
  conversationId: string,
  customerPhone: string,
  text: string,
  traceId: string,
): Promise<void> {
  const result = await sendWhatsAppTextMessage(env, { to: customerPhone, text }, { traceId, conversationId });
  await logOutboundTextMessage({
    env,
    schemaName,
    conversationId,
    text,
    result,
    metadata: { traceId, audioTranscription: "failed" },
  }).catch(() => undefined);
}

function summarizeWhatsAppWebhook(payload: unknown): {
  eventKind: "inbound_message" | "message_status" | "provider_error" | "unknown";
  messageCount: number;
  statusCount: number;
  providerErrorCount: number;
  statusTypes: string[];
} {
  const data = payload as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          messages?: unknown[];
          statuses?: Array<{ status?: unknown }>;
          errors?: unknown[];
        };
      }>;
    }>;
  };
  const values = (data.entry ?? []).flatMap((entry) => (entry.changes ?? []).map((change) => change.value));
  const messageCount = values.reduce((sum, value) => sum + (value?.messages?.length ?? 0), 0);
  const statuses = values.flatMap((value) => value?.statuses ?? []);
  const providerErrorCount = values.reduce((sum, value) => sum + (value?.errors?.length ?? 0), 0);
  const statusTypes = [...new Set(statuses.flatMap((status) => typeof status.status === "string" ? [status.status] : []))];
  const eventKind = messageCount > 0
    ? "inbound_message"
    : statuses.length > 0
      ? "message_status"
      : providerErrorCount > 0
        ? "provider_error"
        : "unknown";

  return { eventKind, messageCount, statusCount: statuses.length, providerErrorCount, statusTypes };
}

function describeWebhookSummary(summary: ReturnType<typeof summarizeWhatsAppWebhook>): string {
  if (summary.eventKind === "inbound_message") {
    return `Meta entregó ${summary.messageCount} mensaje(s) entrante(s).`;
  }
  if (summary.eventKind === "message_status") {
    return `Meta reportó ${summary.statusCount} cambio(s) de estado.`;
  }
  if (summary.eventKind === "provider_error") {
    return `Meta reportó ${summary.providerErrorCount} error(es) del proveedor.`;
  }
  return "Meta entregó un webhook sin mensajes ni estados reconocidos.";
}
