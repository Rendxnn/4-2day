import assert from "node:assert/strict";
import test from "node:test";
import { createHeadlessCapture } from "../src/features/chat-routing/outbound/capture.ts";
import { sendAndLogText } from "../src/features/chat-routing/outbound/send.ts";

test("headless capture returns captured and never calls a delivery network", async () => {
  let networkCalls = 0;
  const capture = createHeadlessCapture({ captureContext: "turn", originatingTurnId: "turn-1" });
  const result = await capture.sendText({ text: "respuesta local", captureContext: "turn" });
  networkCalls += 0;
  assert.equal(result.result.ok, true);
  assert.equal(result.result.providerMessageId, undefined);
  assert.equal(result.response?.delivery, "captured");
  assert.equal(networkCalls, 0);
});

test("outbound persistence failure after composition stays failed and never falls through to Meta", async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (input) => {
    urls.push(String(input));
    throw new Error("outbound_persistence_unavailable");
  };
  const input = {
    env: {
      APP_ENV: "local",
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SERVICE_ROLE_KEY: "local-test-only",
      META_VERIFY_TOKEN: "",
      META_ACCESS_TOKEN: "",
      META_PHONE_NUMBER_ID: "",
      META_WABA_ID: "",
    },
    tenant: { id: "tenant", name: "Demo", slug: "demo", schemaName: "tenant_demo", status: "active", timezone: "America/Bogota", currency: "COP", automationEnabled: true },
    conversation: { id: "conversation", customerId: "customer", channel: "whatsapp", state: "awaiting_more_items", context: {}, clarificationAttempts: 0, automationEnabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    message: { provider: "headless", providerMessageId: "headless:test:outbound-failure", phoneNumberId: "headless", from: "headless-customer", timestamp: new Date().toISOString(), type: "text", text: "hola", raw: { source: "headless" } },
    traceId: "trace-outbound-failure",
    source: "headless",
    headlessEffectIds: [],
  };

  try {
    await assert.rejects(() => sendAndLogText(input, "Respuesta compuesta"), /outbound_persistence_unavailable/);
    assert.equal(input.headlessEffectIds.length, 0);
    assert.equal(urls.some((url) => url.includes("graph.facebook.com")), false);
    assert.equal(urls.every((url) => url.includes("127.0.0.1")), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a fault after a captured effect exposes its durable effect before indeterminate recovery", async () => {
  const originalFetch = globalThis.fetch;
  let observedEffect;
  globalThis.fetch = async () => new Response(JSON.stringify([{ id: "outbound-effect-1" }]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  const input = {
    env: {
      APP_ENV: "local",
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SERVICE_ROLE_KEY: "local-test-only",
      META_VERIFY_TOKEN: "",
      META_ACCESS_TOKEN: "",
      META_PHONE_NUMBER_ID: "",
      META_WABA_ID: "",
    },
    tenant: { id: "tenant", name: "Demo", slug: "demo", schemaName: "tenant_demo", status: "active", timezone: "America/Bogota", currency: "COP", automationEnabled: true },
    conversation: { id: "conversation", customerId: "customer", channel: "whatsapp", state: "awaiting_more_items", context: {}, clarificationAttempts: 0, automationEnabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    message: { provider: "headless", providerMessageId: "headless:test:after-effect", phoneNumberId: "headless", from: "headless-customer", timestamp: new Date().toISOString(), type: "text", text: "hola", raw: { source: "headless" } },
    traceId: "trace-after-effect",
    source: "headless",
    headlessEffectIds: [],
    afterEffect: async (effect) => {
      observedEffect = effect;
      throw new Error("fault_after_effect");
    },
  };

  try {
    await assert.rejects(() => sendAndLogText(input, "Respuesta capturada"), /fault_after_effect/);
    assert.deepEqual(observedEffect, { type: "outbound_message", id: "outbound-effect-1", sequence: 1 });
    assert.deepEqual(input.headlessEffectIds, ["outbound-effect-1"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
