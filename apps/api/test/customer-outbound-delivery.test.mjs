import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createHeadlessCapture } from "../src/features/chat-routing/outbound/capture.ts";
import { sendAndLogText } from "../src/features/chat-routing/outbound/send.ts";

test("the outbound boundary records WhatsApp delivery and headless capture separately", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify([{ id: randomUUID() }]), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };

  const base = {
    env: {
      APP_ENV: "local",
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SERVICE_ROLE_KEY: "local-test-only",
      META_VERIFY_TOKEN: "",
      META_ACCESS_TOKEN: "",
      META_PHONE_NUMBER_ID: "",
      META_WABA_ID: "",
    },
    tenant: {
      id: "tenant",
      name: "Demo",
      slug: "demo",
      schemaName: "tenant_demo",
      status: "active",
      timezone: "America/Bogota",
      currency: "COP",
      automationEnabled: true,
    },
    conversation: { id: "conversation", customerId: "customer", channel: "whatsapp", state: "awaiting_more_items", context: {}, clarificationAttempts: 0, automationEnabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    message: { provider: "headless", providerMessageId: "headless:test:delivery-boundary", phoneNumberId: "headless", from: "headless-customer", timestamp: new Date().toISOString(), type: "text", text: "hola", raw: { source: "headless" } },
    traceId: "trace-delivery-boundary",
    headlessEffectIds: [],
  };

  try {
    const whatsappInput = {
      ...base,
      source: "whatsapp_cloud",
      message: { ...base.message, provider: "whatsapp_cloud", providerMessageId: "whatsapp:test:delivery-boundary" },
      delivery: {
        async sendText() {
          return { result: { ok: true, httpStatus: 200, providerMessageId: "meta-fake-1", raw: { provider: "fake-meta" } } };
        },
      },
    };
    const whatsappId = await sendAndLogText(whatsappInput, "Respuesta WhatsApp");
    const whatsappRequest = requests.at(-1);
    const whatsappBody = JSON.parse(whatsappRequest.init.body);
    assert.equal(typeof whatsappId, "string");
    assert.equal(whatsappBody.provider, "whatsapp_cloud");
    assert.equal(whatsappBody.provider_message_id, "meta-fake-1");
    assert.equal(whatsappBody.status, "sent");

    const headlessInput = {
      ...base,
      source: "headless",
      message: { ...base.message, providerMessageId: "headless:test:delivery-boundary-2" },
      delivery: createHeadlessCapture({ captureContext: "turn", originatingTurnId: "delivery-boundary-2" }),
    };
    const headlessId = await sendAndLogText(headlessInput, "Dirección: Calle 1 #2 3");
    const headlessRequest = requests.at(-1);
    const headlessBody = JSON.parse(headlessRequest.init.body);
    assert.equal(typeof headlessId, "string");
    assert.equal(headlessBody.provider, "headless");
    assert.equal(headlessBody.provider_message_id, null);
    assert.equal(headlessBody.status, "captured");
    assert.equal(headlessBody.payload.internal.capture.delivery, "captured");
    assert.equal(headlessBody.payload.internal.capture.redacted, true);
    assert.equal(headlessInput.headlessEffectIds.length, 1);
    assert.equal(requests.some((request) => request.url.includes("graph.facebook.com")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
