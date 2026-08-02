import { createSupabaseRestClient, SupabaseRestError } from "../../lib/supabase-rest";
import type { ApiBindings } from "../../lib/bindings";

export type RawWebhookLogResult =
  | { status: "logged"; webhookEventId?: string }
  | { status: "duplicate"; duplicateReason: "already_processed" | "already_processing" | "previously_failed" };

type WebhookEventRow = {
  id: string;
  status: "received" | "processed" | "duplicate" | "failed";
  received_at: string;
};

export async function logRawWhatsAppWebhook(env: ApiBindings, payload: unknown): Promise<RawWebhookLogResult> {
  const client = createSupabaseRestClient(env);
  const firstMessage = extractFirstMessage(payload);

  try {
    const rows = await client.insert<WebhookEventRow>({
      schema: "control",
      table: "webhook_events",
      rows: {
        provider: "whatsapp_cloud",
        event_id: firstMessage.eventId,
        provider_message_id: firstMessage.providerMessageId,
        phone_number_id: firstMessage.phoneNumberId,
        payload,
        status: "received",
      },
      returning: "representation",
    });
    return { status: "logged", webhookEventId: rows[0]?.id };
  } catch (error) {
    if (error instanceof SupabaseRestError && error.status === 409) {
      if (!firstMessage.providerMessageId) {
        return { status: "duplicate", duplicateReason: "already_processing" };
      }

      const [existing] = await client.select<WebhookEventRow>({
        schema: "control",
        table: "webhook_events",
        query: {
          select: "id,status,received_at",
          provider: "eq.whatsapp_cloud",
          provider_message_id: `eq.${firstMessage.providerMessageId}`,
          limit: 1,
        },
      });

      if (!existing || existing.status === "processed") {
        return { status: "duplicate", duplicateReason: "already_processed" };
      }

      return {
        status: "duplicate",
        duplicateReason: existing.status === "failed" ? "previously_failed" : "already_processing",
      };
    }

    throw error;
  }
}

export async function markRawWhatsAppWebhookProcessed(env: ApiBindings, webhookEventId: string | undefined): Promise<void> {
  if (!webhookEventId) {
    return;
  }

  const client = createSupabaseRestClient(env);

  await client.update({
    schema: "control",
    table: "webhook_events",
    values: {
      status: "processed",
      processed_at: new Date().toISOString(),
      error_message: null,
    },
    query: {
      id: `eq.${webhookEventId}`,
    },
  });
}

export async function markRawWhatsAppWebhookFailed(
  env: ApiBindings,
  webhookEventId: string | undefined,
  errorMessage: string,
): Promise<void> {
  if (!webhookEventId) {
    return;
  }

  const client = createSupabaseRestClient(env);
  await client.update({
    schema: "control",
    table: "webhook_events",
    values: {
      status: "failed",
      processed_at: new Date().toISOString(),
      error_message: errorMessage.slice(0, 500),
    },
    query: {
      id: `eq.${webhookEventId}`,
    },
  });
}

function extractFirstMessage(payload: unknown): {
  eventId?: string;
  providerMessageId?: string;
  phoneNumberId?: string;
} {
  const data = payload as {
    entry?: Array<{
      id?: string;
      changes?: Array<{
        value?: {
          metadata?: { phone_number_id?: string };
          messages?: Array<{ id?: string }>;
        };
      }>;
    }>;
  };

  const entry = data.entry?.[0];
  const change = entry?.changes?.[0];
  const message = change?.value?.messages?.[0];

  return {
    eventId: entry?.id,
    providerMessageId: message?.id,
    phoneNumberId: change?.value?.metadata?.phone_number_id,
  };
}
