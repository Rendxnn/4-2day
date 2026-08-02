import type { OutboundImageMessage, OutboundMessageResult, OutboundTextMessage } from "@42day/types";
import type { ApiBindings } from "../../lib/bindings";
import { logEvent, sanitizeErrorDetail } from "../../lib/observability/logger.ts";

type WhatsAppSendTextResponse = {
  messaging_product?: "whatsapp";
  contacts?: Array<{ input: string; wa_id: string }>;
  messages?: Array<{ id: string }>;
  error?: {
    message?: unknown;
    type?: unknown;
    code?: unknown;
    error_subcode?: unknown;
  };
};

type WhatsAppLogContext = {
  traceId?: string;
  tenantId?: string;
  conversationId?: string;
};

export async function sendWhatsAppTextMessage(
  env: ApiBindings,
  message: OutboundTextMessage,
  context: WhatsAppLogContext = {},
): Promise<OutboundMessageResult> {
  return sendWhatsAppMessage(env, {
    messaging_product: "whatsapp",
    to: message.to,
    type: "text",
    text: {
      preview_url: false,
      body: message.text,
    },
  }, context);
}

export async function sendWhatsAppImageMessage(
  env: ApiBindings,
  message: OutboundImageMessage,
  context: WhatsAppLogContext = {},
): Promise<OutboundMessageResult> {
  return sendWhatsAppMessage(env, {
    messaging_product: "whatsapp",
    to: message.to,
    type: "image",
    image: {
      link: message.imageUrl,
      ...(message.caption ? { caption: message.caption } : {}),
    },
  }, context);
}

async function sendWhatsAppMessage(
  env: ApiBindings,
  payload: { to: string } & Record<string, unknown>,
  context: WhatsAppLogContext,
): Promise<OutboundMessageResult> {
  const version = env.META_GRAPH_API_VERSION ?? "v22.0";
  const url = `https://graph.facebook.com/${version}/${env.META_PHONE_NUMBER_ID}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.META_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = (await response.json().catch(() => ({}))) as WhatsAppSendTextResponse;

  if (!response.ok) {
    const providerError = {
      code: typeof body.error?.code === "string" || typeof body.error?.code === "number" ? body.error.code : undefined,
      subcode: typeof body.error?.error_subcode === "string" || typeof body.error?.error_subcode === "number" ? body.error.error_subcode : undefined,
      type: typeof body.error?.type === "string" ? body.error.type : undefined,
      safeDetail: typeof body.error?.message === "string" ? sanitizeErrorDetail(body.error.message) : "Meta rejected the outbound message.",
    };
    logEvent("error", "whatsapp.outbound.failed", "Meta rechazó el mensaje saliente.", {
      environment: env.APP_ENV,
      ...context,
      httpStatus: response.status,
      messageType: typeof payload.type === "string" ? payload.type : "unknown",
      error: providerError,
    });
    return {
      ok: false,
      httpStatus: response.status,
      providerMessageId: body.messages?.[0]?.id,
      error: providerError,
      raw: body,
    };
  }

  logEvent("info", "whatsapp.outbound.accepted", "Meta aceptó el mensaje saliente.", {
    environment: env.APP_ENV,
    ...context,
    httpStatus: response.status,
    messageType: typeof payload.type === "string" ? payload.type : "unknown",
    providerMessageId: body.messages?.[0]?.id,
  });

  return {
    ok: true,
    httpStatus: response.status,
    providerMessageId: body.messages?.[0]?.id,
    raw: body,
  };
}
