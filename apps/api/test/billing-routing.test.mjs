import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isValidNormalBillingFullName } from "../src/features/chat-routing/checkout/billing-helpers.ts";
import { detectSignals } from "../src/modules/message-router/signal-detector.ts";

const routerPath = new URL("../src/features/chat-routing/router.ts", import.meta.url);

test("accepts a normal billing full name without relying on semantic planning", () => {
  assert.equal(isValidNormalBillingFullName("Yohana Fernandez Ortiz"), true);
  assert.equal(isValidNormalBillingFullName("Yohana"), false);
  assert.equal(isValidNormalBillingFullName("quiero cambiar pedido"), false);
});

test("recognizes yes or no while asking whether to reuse billing data", () => {
  const signals = detectSignals({
    message: {
      providerMessageId: "billing-reuse-1",
      from: "573001234567",
      type: "text",
      text: "si",
      timestamp: new Date().toISOString(),
    },
    state: "awaiting_billing_reuse_confirmation",
  });

  assert.equal(signals.confirmation, "yes");
});

test("acepta las formas naturales de conservar los datos de facturación sin depender de IA", () => {
  for (const text of ["igual", "sigue igual", "así está bien", "sí, déjalos igual por favor"]) {
    const signals = detectSignals({
      message: {
        providerMessageId: `billing-reuse-${text}`,
        from: "573001234567",
        type: "text",
        text,
        timestamp: new Date().toISOString(),
      },
      state: "awaiting_billing_reuse_confirmation",
    });

    assert.equal(signals.confirmation, "yes", text);
  }

  const finalConfirmationSignals = detectSignals({
    message: {
      providerMessageId: "order-confirmation-igual",
      from: "573001234567",
      type: "text",
      text: "igual",
      timestamp: new Date().toISOString(),
    },
    state: "awaiting_confirmation",
  });

  assert.equal(finalConfirmationSignals.confirmation, null);
});

test("routes billing text through the semantic catalog before backend execution", async () => {
  const source = await readFile(routerPath, "utf8");
  const semanticFallbackIndex = source.indexOf("if (await trySemanticFallback(input))");
  assert.ok(semanticFallbackIndex > -1);
  assert.doesNotMatch(source, /tryHandleNormalBillingInfo\(input/);
  assert.doesNotMatch(source, /tryHandleElectronicBillingInfo\(input\)/);
  assert.match(await readFile(new URL("../src/features/chat-routing/semantic/operation-plan.ts", import.meta.url), "utf8"), /set_billing/);
});

test("un saludo durante checkout se interpreta con el estado vigente", async () => {
  const source = await readFile(routerPath, "utf8");

  assert.match(source, /all_text_requires_semantic_plan/);
  assert.doesNotMatch(source, /isActiveOrderState\(input\.conversation\.state\)/);
  assert.doesNotMatch(source, /buildMenuText\(menu\)/);
});
