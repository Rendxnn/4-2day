import assert from "node:assert/strict";
import test from "node:test";
import { projectCapturedResponse } from "../src/features/chat-routing/outbound/capture.ts";
import { assertSafeProjection, canonicalizeParity } from "./support/headless-chat-harness.mjs";

test("parity comparison keeps transport projection separate from captured business text", () => {
  const whatsappText = "Pedido recibido";
  const headless = projectCapturedResponse({ type: "text", text: whatsappText, captureContext: "turn", originatingTurnId: "turn-1" });
  assert.equal(headless.text, whatsappText);
  assert.equal(headless.delivery, "captured");
});

test("parity canonicalization ignores transport identity but preserves business differences", () => {
  const whatsapp = {
    provider: "whatsapp_cloud",
    providerMessageId: "meta-1",
    source: "whatsapp",
    createdAt: "2026-08-13T12:00:00.000Z",
    conversationId: "conversation-a",
    total: 18000,
    state: "awaiting_confirmation",
  };
  const headless = {
    provider: "headless",
    providerMessageId: "headless-1",
    source: "headless",
    createdAt: "2026-08-13T12:05:00.000Z",
    conversationId: "conversation-b",
    total: 18000,
    state: "awaiting_confirmation",
  };

  assert.deepEqual(canonicalizeParity(whatsapp), canonicalizeParity(headless));
  assert.notDeepEqual(canonicalizeParity(whatsapp), canonicalizeParity({ ...headless, total: 19000 }));
});

const parityScenarios = [
  ["P-01", "awaiting_mode_selection", "show_menu", "Menú disponible", null, null],
  ["P-02", "awaiting_more_items", "get_order_status", "Tu pedido sigue en preparación.", null, null],
  ["P-03", "awaiting_more_items", "request_human", "Te comunicaré con el restaurante.", null, null],
  ["P-04", "awaiting_more_items", "add_product", "Agregué el producto.", { itemCount: 1, total: 18000 }, null],
  ["P-05", "awaiting_more_items", "clarification", "No pude identificar ese producto.", null, null],
  ["P-06", "awaiting_payment_method", "set_payment_method", "Elegí transferencia.", { itemCount: 1, total: 18000 }, null],
  ["P-07", "awaiting_product_configuration", "set_line_configuration", "Falta una configuración.", { itemCount: 1, total: 19500 }, null],
  ["P-08", "awaiting_confirmation", "confirm_order", "Pedido confirmado.", { itemCount: 1, total: 18000 }, { state: "pending_restaurant_confirmation", total: 18000 }],
  ["P-09", "awaiting_more_items", "clarification", "Necesito una aclaración.", null, null],
  ["P-10", "awaiting_more_items", "request_human", "Voy a solicitar ayuda humana.", null, null],
  ["P-11", "awaiting_more_items", "add_product", "Agregué el producto.", { itemCount: 1, total: 18000 }, null],
  ["P-12", "awaiting_more_items", "clarification", "No puedo procesarlo ahora.", null, null],
  ["P-13", "manual", "none", "", null, null],
  ["P-14", "awaiting_more_items", "add_product", "Procesé el mensaje pendiente.", { itemCount: 1, total: 18000 }, null],
  ["P-15", "awaiting_address", "set_delivery_address", "Dirección: Calle 58 sur #42 99\nFacturación: Cliente Demo", { itemCount: 1, total: 23000 }, null],
];

for (const [scenarioId, state, operationType, responseText, draft, order] of parityScenarios) {
  test(`parity contract matrix ${scenarioId} keeps business output equal across transports`, () => {
    const whatsapp = buildTransportObservation({ state, operationType, responseText, draft, order, transport: "whatsapp" });
    const headless = buildTransportObservation({ state, operationType, responseText, draft, order, transport: "headless" });

    assert.deepEqual(canonicalizeBusinessObservation(whatsapp.internal), canonicalizeBusinessObservation(headless.internal));
    assert.equal(whatsapp.internal.transport, "whatsapp");
    assert.equal(headless.internal.transport, "headless");
    assertSafeProjection(headless.publicResponse);
    if (scenarioId === "P-15") {
      assert.equal(headless.publicResponse.redacted, true);
      assert.deepEqual(headless.publicResponse.redactionCodes.sort(), ["LOCATION_OR_BILLING"]);
      assert.equal(headless.internal.response.text, responseText);
    } else {
      assert.equal(headless.publicResponse.redacted, false);
    }
  });
}

function canonicalizeBusinessObservation(observation) {
  const { transport, provider, providerMessageId, delivery, ...business } = observation;
  return canonicalizeParity(business);
}

function buildTransportObservation(input) {
  const publicResponse = projectCapturedResponse({
    type: "text",
    text: input.responseText,
    captureContext: "turn",
    originatingTurnId: `${input.transport}-turn-001`,
  });
  return {
    publicResponse,
    internal: {
      conversation: { state: input.state, automation: input.state === "manual" ? "manual" : "enabled", expiry: "active" },
      draft: input.draft ? { ...input.draft, state: "open" } : null,
      order: input.order ? { ...input.order } : null,
      routing: {
        branch: input.operationType === "none" ? "deterministic" : "llm",
        reasonCode: input.operationType === "none" ? "automation_paused" : "semantic_operation",
        ai: { attempted: input.state !== "manual", used: input.operationType !== "none", operationTypes: input.operationType === "none" ? [] : [input.operationType] },
      },
      effects: input.responseText ? [{ type: "outbound_message", status: "created" }] : [],
      response: { type: "text", text: input.responseText },
      transport: input.transport,
      provider: input.transport === "whatsapp" ? "whatsapp_cloud" : "headless",
      providerMessageId: `${input.transport}-message-001`,
      delivery: input.transport === "whatsapp" ? "sent" : "captured",
    },
  };
}
