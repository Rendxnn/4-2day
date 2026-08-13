import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  detectSignals,
  parseSemanticFulfillmentSelection,
  parseSemanticPaymentMethod,
} from "../src/modules/message-router/signal-detector.ts";
import { resolveEntryFlowAction } from "../src/features/chat-routing/entry-flow.ts";

const routerSource = readFileSync(new URL("../src/features/chat-routing/router.ts", import.meta.url), "utf8");

function detect(text, state) {
  return detectSignals({
    message: {
      providerMessageId: "msg-routing-policy",
      from: "573001234567",
      type: "text",
      text,
      timestamp: new Date().toISOString(),
    },
    state,
  });
}

test("solo acepta un pago deterministico exacto en el estado de pago", () => {
  assert.equal(detect("efectivo", "awaiting_payment_method").paymentMethod, "cash");
  assert.equal(detect("transferencia", "awaiting_payment_method").paymentMethod, "transfer");
  assert.equal(detect("quiero pagar en efectivo y agregar un jugo", "awaiting_payment_method").paymentMethod, null);
  assert.equal(detect("efectivo", "awaiting_more_items").paymentMethod, null);
});

test("solo acepta fulfillment y confirmacion deterministas exactos en estados permitidos", () => {
  assert.equal(detect("recoger", "awaiting_fulfillment_type").fulfillmentType, "pickup");
  assert.equal(detect("quiero recoger y agregar una bebida", "awaiting_fulfillment_type").fulfillmentType, null);
  assert.equal(detect("confirmo", "awaiting_confirmation").confirmation, "yes");
  assert.equal(detect("confirmo y agrega otro", "awaiting_confirmation").confirmation, null);
  assert.equal(detect("confirmo", "awaiting_more_items").confirmation, null);
});

test("solo normaliza valores semanticos canonicos antes de aplicarlos al draft", () => {
  assert.equal(parseSemanticPaymentMethod("transferencia"), "transfer");
  assert.equal(parseSemanticPaymentMethod("paga como quieras"), null);
  assert.equal(parseSemanticFulfillmentSelection("domicilio"), "delivery");
  assert.equal(parseSemanticFulfillmentSelection("mandalo donde estoy"), null);
});

test("solo trata como direccion deterministica un formato postal reconocible", () => {
  assert.equal(detect("calle 10 # 5-20", "awaiting_address").looksLikeAddress, true);
  assert.equal(detect("vivo por el parque central", "awaiting_address").looksLikeAddress, false);
});

test("solo los controles explicitos omiten la interpretacion semantica al iniciar", () => {
  assert.equal(resolveEntryFlowAction(detect("hola", "awaiting_mode_selection")), "show_menu");
  assert.equal(resolveEntryFlowAction(detect("menú", "awaiting_mode_selection")), "show_menu");
  assert.equal(resolveEntryFlowAction(detect("asesor", "awaiting_mode_selection")), "handoff");
  assert.equal(
    resolveEntryFlowAction(detect("para pedirte por favor un domicilio de dos pollos asados", "awaiting_mode_selection")),
    null,
  );
  assert.equal(resolveEntryFlowAction(detect("dos desayunos naturales", "awaiting_mode_selection")), null);
});

test("el router envía pagos y configurables al fallback semántico", () => {
  const semanticFallbackIndex = routerSource.indexOf("if (await trySemanticFallback(input))");
  assert.ok(semanticFallbackIndex >= 0);
  assert.equal(routerSource.includes("tryHandlePaymentMethod(input, signals)"), false);
  assert.equal(routerSource.includes("tryHandlePendingProductConfiguration(input, { signals })"), false);
});
