import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { processNormalizedChatTurn } from "../src/features/chat-routing/process-normalized-chat-turn.ts";
import { loadActiveDraftOrder } from "../src/features/draft-orders/service.ts";
import { executeHeadlessCommand } from "../src/features/headless-chat/application.ts";
import { createMemoryJournalStore } from "../src/features/headless-chat/session-journal.ts";
import { loadHeadlessSnapshot } from "../src/features/headless-chat/snapshot.ts";
import { resolveHeadlessTenant } from "../src/features/headless-chat/tenant.ts";
import { pauseConversationAutomation } from "../src/features/conversations/service.ts";
import { selectConversationById } from "../src/features/conversations/repository.ts";
import { mapConversationRow } from "../src/features/conversations/mappers.ts";
import { assertSafeProjection, canonicalizeParity } from "./support/headless-chat-harness.mjs";

const scenarios = [
  { id: "P-01", text: "Hola, muéstrame el menú", plan: "show_menu" },
  { id: "P-02", prepare: ["add"], text: "¿Qué tengo en el pedido?", plan: "get_order_status" },
  { id: "P-03", text: "Quiero hablar con una persona", plan: "request_human" },
  { id: "P-04", text: "Quiero una hamburguesa clásica", plan: "add_product" },
  { id: "P-05", text: "Agrega el producto desconocido", plan: "unknown_product" },
  { id: "P-06", prepare: ["add", "pickup", "billing"], text: "Quiero pagar por transferencia", plan: "payment" },
  { id: "P-07", prepare: ["add"], text: "Cambia la configuración", plan: "line_configuration" },
  { id: "P-08", prepare: ["add", "pickup", "billing", "payment"], text: "Sí, confirma el pedido", plan: "confirm_order" },
  { id: "P-09", text: "No estoy seguro", plan: "empty" },
  { id: "P-10", prepare: ["add"], text: "Necesito ayuda humana", plan: "request_human" },
  { id: "P-11", prepare: ["add"], text: "Agrega otra hamburguesa clásica", plan: "add_product" },
  { id: "P-12", text: "Interpreta esto con poca confianza", plan: "low_confidence" },
  { id: "P-13", text: "Quiero agregar algo mientras revisan", plan: "show_menu", manual: true },
  { id: "P-14", prepare: ["add"], text: "Quiero domicilio", plan: "delivery" },
  { id: "P-15", prepare: ["add", "delivery"], text: "Calle 58 sur #42 99", plan: "address" },
];

test("the 15 parity scenarios execute through the real normalized boundary", {
  skip: process.env.HEADLESS_SUPABASE_INTEGRATION !== "1",
}, async () => {
  const { env, configText } = await readLocalContext();
  const tenant = await resolveHeadlessTenant({
    env,
    slug: "headless-demo",
    exposedSchemas: ["control", "tenant_template", "tenant_headless_demo", "tenant_headless_isolation_b"],
  });

  const results = [];
  for (const scenario of scenarios) {
    const semanticGeneration = createScenarioGenerator(scenario);
    const whatsapp = await createSession({ env, configText, semanticGeneration });
    const headless = await createSession({ env, configText, semanticGeneration });

    for (const preparation of scenario.prepare ?? []) {
      const preparationText = preparationTextFor(preparation);
      await processWhatsAppTurn({ env, tenant, session: whatsapp, semanticGeneration, text: preparationText });
      const prepared = await executeHeadlessCommand(headless.context, {
        version: 1,
        command: "turn",
        tenant: "headless-demo",
        sessionId: headless.sessionId,
        turnId: `parity-${scenario.id}-${preparation}`,
        text: preparationText,
      });
      assert.equal(prepared.status, "applied", JSON.stringify(prepared));
    }

    if (scenario.manual) {
      await pauseBothConversations({ env, whatsapp, headless });
    }

    const whatsappResult = await processWhatsAppTurn({ env, tenant, session: whatsapp, semanticGeneration, text: scenario.text });
    const headlessResult = await executeHeadlessCommand(headless.context, {
      version: 1,
      command: "turn",
      tenant: "headless-demo",
      sessionId: headless.sessionId,
      turnId: `parity-${scenario.id}`,
      text: scenario.text,
    });
    const whatsappState = await readBusinessState({ env, conversationId: whatsapp.conversationId });

    assert.deepEqual(
      whatsappResult.responses.map(canonicalizeResponseText),
      (headlessResult.responses ?? []).map((response) => canonicalizeResponseText(response.text)),
      `${scenario.id} response mismatch`,
    );
    assert.deepEqual(
      canonicalizeBusinessState(whatsappState),
      canonicalizeBusinessState(headlessResult.after),
      `${scenario.id} state mismatch`,
    );
    if (!scenario.manual) {
      assert.equal(whatsappResult.routingTrace.llm?.operationTypes?.[0] ?? null, expectedOperationType(scenario.plan));
      assert.equal(headlessResult.routing?.ai?.operationTypes?.[0] ?? null, expectedOperationType(scenario.plan));
    } else {
      assert.equal(headlessResult.status, "pending", JSON.stringify(headlessResult));
    }
    for (const response of headlessResult.responses ?? []) assertSafeProjection(response);

    results.push({ id: scenario.id, status: headlessResult.status, operation: expectedOperationType(scenario.plan) });
  }

  assert.equal(results.length, 15);
  assert.ok(results.some((result) => result.status === "pending"));
});

function createScenarioGenerator(scenario) {
  return {
    provider: "test_double",
    generate: async ({ rawMessage, context }) => {
      const planName = rawMessage.startsWith("prep:")
        ? rawMessage.split(":")[1]?.split(" ")[0]
        : scenario.plan;
      const menuItem = context.menu.find((item) => item.name?.toLocaleLowerCase("es-CO").includes("hamburguesa"));
      const plans = {
        add: { confidence: 1, operations: [{ type: "add_product", menuItemId: menuItem?.menuItemId, quantity: 1 }] },
        pickup: { confidence: 1, operations: [{ type: "set_fulfillment", fulfillmentType: "pickup" }] },
        billing: { confidence: 1, operations: [{ type: "set_billing", billing: { type: "normal", fullName: "Cliente Paridad" } }] },
        payment: { confidence: 1, operations: [{ type: "set_payment_method", paymentMethod: "transfer" }] },
        delivery: { confidence: 1, operations: [{ type: "set_fulfillment", fulfillmentType: "delivery" }] },
        show_menu: { confidence: 1, operations: [{ type: "show_menu" }] },
        get_order_status: { confidence: 1, operations: [{ type: "get_order_status" }] },
        request_human: { confidence: 1, operations: [{ type: "request_human" }] },
        add_product: { confidence: 1, operations: [{ type: "add_product", menuItemId: menuItem?.menuItemId, quantity: 1 }] },
        unknown_product: { confidence: 1, operations: [{ type: "add_product", menuItemId: "00000000-0000-0000-0000-000000000000", quantity: 1 }] },
        payment: { confidence: 1, operations: [{ type: "set_payment_method", paymentMethod: "transfer" }] },
        line_configuration: { confidence: 1, operations: [{ type: "set_line_configuration", draftOrderItemId: "00000000-0000-0000-0000-000000000000", configuration: [] }] },
        confirm_order: { confidence: 1, operations: [{ type: "confirm_order" }] },
        empty: { confidence: 1, operations: [] },
        low_confidence: { confidence: 0.2, operations: [{ type: "show_menu" }] },
        address: { confidence: 1, operations: [{ type: "set_delivery_address", addressText: "Calle 58 sur #42 99" }] },
      };
      return plans[planName] ?? plans[scenario.plan];
    },
  };
}

function expectedOperationType(plan) {
  return {
    show_menu: "show_menu",
    get_order_status: "get_order_status",
    request_human: "request_human",
    add_product: "add_product",
    unknown_product: "add_product",
    payment: "set_payment_method",
    line_configuration: "set_line_configuration",
    confirm_order: "confirm_order",
    empty: null,
    low_confidence: "show_menu",
    delivery: "set_fulfillment",
    address: "set_delivery_address",
  }[plan] ?? null;
}

function preparationTextFor(preparation) {
  return {
    add: "prep:add Quiero una hamburguesa clásica",
    pickup: "prep:pickup Quiero recogerlo en el local",
    billing: "prep:billing Mi nombre completo es Cliente Paridad",
    payment: "prep:payment Quiero pagar por transferencia",
    delivery: "prep:delivery Quiero domicilio",
  }[preparation];
}

async function createSession({ env, configText, semanticGeneration }) {
  const context = { env, configText, journal: createMemoryJournalStore(), semanticGeneration };
  const started = await executeHeadlessCommand(context, { version: 1, command: "start", tenant: "headless-demo" });
  assert.equal(started.status, "started", JSON.stringify(started));
  const session = (await context.journal.read()).sessions.find((candidate) => candidate.id === started.session.id);
  assert.ok(session?.conversationId);
  return { context, sessionId: started.session.id, conversationId: session.conversationId };
}

async function processWhatsAppTurn({ env, tenant, session, semanticGeneration, text }) {
  const row = await selectConversationById({ env, schemaName: tenant.schemaName, conversationId: session.conversationId });
  assert.ok(row);
  const responses = [];
  const providerMessageId = `parity-whatsapp-${randomUUID()}`;
  const routingInput = {
    env,
    tenant,
    conversation: mapConversationRow(row),
    message: {
      provider: "whatsapp_cloud",
      providerMessageId,
      phoneNumberId: "parity-test",
      from: "parity-test-customer",
      type: "text",
      text,
      raw: { source: "parity-integration" },
    },
    traceId: `parity-${providerMessageId}`,
    source: "whatsapp_cloud",
    semanticGeneration,
    delivery: {
      async sendText(input) {
        responses.push(input.text);
        return { result: { ok: true, httpStatus: 200, providerMessageId: `fake:${providerMessageId}`, raw: {} } };
      },
    },
  };
  await processNormalizedChatTurn(routingInput);
  return { responses, routingTrace: routingInput.routingTrace };
}

async function pauseBothConversations({ env, whatsapp, headless }) {
  for (const session of [whatsapp, headless]) {
    const row = await selectConversationById({ env, schemaName: "tenant_headless_demo", conversationId: session.conversationId });
    assert.ok(row);
    await pauseConversationAutomation({
      env,
      schemaName: "tenant_headless_demo",
      conversation: mapConversationRow(row),
      manualReason: "parity-test-pause",
      changedBy: "00000000-0000-0000-0000-000000000001",
    });
  }
}

async function readBusinessState({ env, conversationId }) {
  const row = await selectConversationById({ env, schemaName: "tenant_headless_demo", conversationId });
  assert.ok(row);
  const conversation = mapConversationRow(row);
  return loadHeadlessSnapshot({ env, schemaName: "tenant_headless_demo", conversation });
}

function canonicalizeBusinessState(value) {
  if (!value) return value;
  const { id: _id, ...conversation } = value.conversation ?? {};
  return canonicalizeParity({
    conversation,
    draft: value.draft ? { ...value.draft, id: "draft" } : null,
    order: value.order ? { ...value.order, id: "order" } : null,
  });
}

function canonicalizeResponseText(value) {
  return typeof value === "string"
    ? value.replace(/\b[0-9a-f]{8}(?:-[0-9a-f-]{27})?\b/gi, "<opaque-id>")
    : value;
}

async function readLocalContext() {
  const [envText, configText] = await Promise.all([
    readFile(new URL("../.env.headless.local", import.meta.url), "utf8"),
    readFile(new URL("../../../supabase/config.toml", import.meta.url), "utf8"),
  ]);
  const values = {};
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return {
    configText,
    env: {
      APP_ENV: values.APP_ENV ?? "",
      PARAHOY_HEADLESS_DEBUG: values.PARAHOY_HEADLESS_DEBUG,
      PARAHOY_HEADLESS_LOCAL_PROJECT_ID: values.PARAHOY_HEADLESS_LOCAL_PROJECT_ID,
      SUPABASE_URL: values.SUPABASE_URL ?? "",
      SUPABASE_SERVICE_ROLE_KEY: values.SUPABASE_SERVICE_ROLE_KEY ?? "",
      SUPABASE_ANON_KEY: values.SUPABASE_ANON_KEY,
      META_VERIFY_TOKEN: values.META_VERIFY_TOKEN ?? "",
      META_ACCESS_TOKEN: values.META_ACCESS_TOKEN ?? "",
      META_PHONE_NUMBER_ID: values.META_PHONE_NUMBER_ID ?? "",
      META_WABA_ID: values.META_WABA_ID ?? "",
      GEMINI_API_KEY: values.GEMINI_API_KEY,
      GEMINI_MODEL: values.GEMINI_MODEL,
    },
  };
}
