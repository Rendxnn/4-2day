import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { executeHeadlessCommand } from "../src/features/headless-chat/application.ts";
import { createMemoryJournalStore } from "../src/features/headless-chat/session-journal.ts";
import { selectConversationById } from "../src/features/conversations/repository.ts";
import { mapConversationRow } from "../src/features/conversations/mappers.ts";
import { changeConversationAutomation, pauseConversationAutomation } from "../src/features/conversations/service.ts";
import { createSupabaseRestClient } from "../src/lib/supabase-rest.ts";

test("inline test double exercises the complete headless application flow against local Supabase", { skip: process.env.HEADLESS_SUPABASE_INTEGRATION !== "1" }, async () => {
  const [envText, configText] = await Promise.all([
    readFile(new URL("../.env.headless.local", import.meta.url), "utf8"),
    readFile(new URL("../../../supabase/config.toml", import.meta.url), "utf8"),
  ]);
  const env = parseLocalEnv(envText);
  const context = {
    env,
    configText,
    journal: createMemoryJournalStore(),
    semanticGeneration: {
      provider: "test_double:inline",
      generate: async ({ rawMessage, context: semanticContext }) => {
        const normalized = rawMessage.toLocaleLowerCase("es-CO");
        if (normalized.includes("menú") || normalized.includes("menu")) {
          return { confidence: 1, operations: [{ type: "show_menu" }] };
        }
        if (normalized.includes("estado") || normalized.includes("qué tengo") || normalized.includes("que tengo")) {
          return { confidence: 1, operations: [{ type: "get_order_status" }] };
        }
        if (normalized.includes("hamburguesa")) {
          const menuItem = semanticContext.menu.find((item) => item.name?.toLocaleLowerCase("es-CO").includes("hamburguesa"));
          assert.ok(menuItem?.menuItemId, "the local test tenant must expose a hamburger menu item");
          return { confidence: 1, operations: [{ type: "add_product", menuItemId: menuItem.menuItemId, quantity: 1 }] };
        }
        if (normalized.includes("recoger") || normalized.includes("recogida")) {
          return { confidence: 1, operations: [{ type: "set_fulfillment", fulfillmentType: "pickup" }] };
        }
        if (normalized.includes("nombre")) {
          return { confidence: 1, operations: [{ type: "set_billing", billing: { type: "normal", fullName: "Cliente Inline" } }] };
        }
        if (normalized.includes("transferencia")) {
          return { confidence: 1, operations: [{ type: "set_payment_method", paymentMethod: "transfer" }] };
        }
        if (normalized.includes("confirma") || normalized.includes("confirmar")) {
          return { confidence: 1, operations: [{ type: "confirm_order" }] };
        }
        return { confidence: 1, operations: [] };
      },
    },
  };

  const started = await executeHeadlessCommand(context, { version: 1, command: "start", tenant: "headless-demo" });
  assert.equal(started.status, "started", JSON.stringify(started));
  const sessionId = started.session.id;
  const turns = [
    ["inline-001", "Hola, muéstrame el menú", "show_menu"],
    ["inline-002", "Quiero una hamburguesa clásica", "add_product"],
    ["inline-003", "¿Qué tengo en el pedido?", "get_order_status"],
    ["inline-004", "Prefiero recogerlo en el local", "set_fulfillment"],
    ["inline-005", "Mi nombre completo es Cliente Inline", "set_billing"],
    ["inline-006", "Quiero pagar por transferencia", "set_payment_method"],
    ["inline-007", "¿Cuál es el estado de mi pedido?", "get_order_status"],
    ["inline-008", "Sí, confirma el pedido", "confirm_order"],
  ];
  const observedEffectTypes = new Set();

  for (const [turnId, text, operationType] of turns) {
    const result = await executeHeadlessCommand(context, { version: 1, command: "turn", tenant: "headless-demo", sessionId, turnId, text });
    assert.equal(result.status, "applied", JSON.stringify(result));
    assert.equal(result.routing?.ai?.provider, "test_double", JSON.stringify(result));
    assert.deepEqual(result.routing?.ai?.operationTypes, [operationType]);
    assert.ok(result.responses?.every((response) => response.delivery === "captured"));
    assert.ok(result.effects?.every((effect) => effect.type !== "meta_message"));
    for (const effect of result.effects ?? []) observedEffectTypes.add(effect.type);
  }

  assert.equal(observedEffectTypes.has("draft_order_mutation"), true);
  assert.equal(observedEffectTypes.has("order_mutation"), true);

  const repeated = await executeHeadlessCommand(context, { version: 1, command: "turn", tenant: "headless-demo", sessionId, turnId: "inline-008", text: "Sí, confirma el pedido" });
  assert.equal(repeated.status, "repeated");

  const conflict = await executeHeadlessCommand(context, { version: 1, command: "turn", tenant: "headless-demo", sessionId, turnId: "inline-008", text: "Quiero cambiar el pedido" });
  assert.equal(conflict.error?.code, "IDEMPOTENCY_CONFLICT");

  const inspected = await executeHeadlessCommand(context, { version: 1, command: "inspect", tenant: "headless-demo", sessionId });
  assert.equal(inspected.status, "inspected");
  assert.equal(inspected.routing?.ai?.provider, "test_double");
  assert.equal(inspected.after?.order?.state, "pending_restaurant_confirmation");
  assert.ok((inspected.after?.order?.total ?? 0) > 0);

  const closed = await executeHeadlessCommand(context, { version: 1, command: "close", tenant: "headless-demo", sessionId });
  assert.equal(closed.status, "closed");
});

test("a post-effect failure remains indeterminate and reconciliation does not replay", { skip: process.env.HEADLESS_SUPABASE_INTEGRATION !== "1" }, async () => {
  let capturedEffect;
  const context = await createIntegrationContext({
    afterEffect: async (effect) => {
      capturedEffect = effect;
      throw new Error("injected_after_effect");
    },
  });
  const started = await executeHeadlessCommand(context, { version: 1, command: "start", tenant: "headless-demo" });
  assert.equal(started.status, "started", JSON.stringify(started));
  const turn = await executeHeadlessCommand(context, {
    version: 1,
    command: "turn",
    tenant: "headless-demo",
    sessionId: started.session.id,
    turnId: "inline-fault-after-effect",
    text: "Hola, muéstrame el menú",
  });
  assert.equal(turn.status, "indeterminate", JSON.stringify(turn));
  assert.equal(turn.error?.code, "TURN_INDETERMINATE");
  assert.equal(capturedEffect?.type, "outbound_message");

  const inspected = await executeHeadlessCommand(context, { version: 1, command: "inspect", tenant: "headless-demo", sessionId: started.session.id });
  assert.equal(inspected.turn?.state, "indeterminate");
  const reconciled = await executeHeadlessCommand(context, {
    version: 1,
    command: "reconcile",
    tenant: "headless-demo",
    sessionId: started.session.id,
    turnId: "inline-fault-after-effect",
    observedOutcome: "effects_applied",
  });
  assert.equal(reconciled.status, "indeterminate", JSON.stringify(reconciled));
});

test("a failure before the checkpoint leaves no business effect and no replay path", { skip: process.env.HEADLESS_SUPABASE_INTEGRATION !== "1" }, async () => {
  let generationCalls = 0;
  let checkpointManifest;
  const context = await createIntegrationContext({
    semanticGeneration: {
      provider: "test_double:inline",
      generate: async () => {
        generationCalls += 1;
        return { confidence: 1, operations: [{ type: "show_menu" }] };
      },
    },
    beforeCheckpoint: async (manifest) => {
      checkpointManifest = manifest;
      throw new Error("injected_before_checkpoint");
    },
  });
  const started = await executeHeadlessCommand(context, { version: 1, command: "start", tenant: "headless-demo" });
  assert.equal(started.status, "started", JSON.stringify(started));

  const turn = await executeHeadlessCommand(context, {
    version: 1,
    command: "turn",
    tenant: "headless-demo",
    sessionId: started.session.id,
    turnId: "inline-fault-before-checkpoint",
    text: "Hola, muéstrame el menú",
  });
  assert.equal(turn.status, "indeterminate", JSON.stringify(turn));
  assert.equal(checkpointManifest?.operationTypes[0], "show_menu");

  const inspected = await executeHeadlessCommand(context, { version: 1, command: "inspect", tenant: "headless-demo", sessionId: started.session.id });
  assert.equal(inspected.turn?.state, "indeterminate");
  assert.equal(inspected.after?.draft, null);
  assert.equal(inspected.after?.order, null);
  assert.equal(inspected.responses.length, 0);

  const repeated = await executeHeadlessCommand(context, {
    version: 1,
    command: "turn",
    tenant: "headless-demo",
    sessionId: started.session.id,
    turnId: "inline-fault-before-checkpoint",
    text: "Hola, muéstrame el menú",
  });
  assert.equal(repeated.status, "indeterminate", JSON.stringify(repeated));
  assert.equal(generationCalls, 1);
});

test("a failure after the durable checkpoint remains indeterminate before effects", { skip: process.env.HEADLESS_SUPABASE_INTEGRATION !== "1" }, async () => {
  let checkpointManifest;
  const context = await createIntegrationContext({
    semanticGeneration: {
      provider: "test_double",
      generate: async () => ({ confidence: 1, operations: [{ type: "show_menu" }] }),
    },
    afterCheckpoint: async (manifest) => {
      checkpointManifest = manifest;
      throw new Error("injected_after_checkpoint");
    },
  });
  const started = await executeHeadlessCommand(context, { version: 1, command: "start", tenant: "headless-demo" });
  assert.equal(started.status, "started", JSON.stringify(started));

  const turn = await executeHeadlessCommand(context, {
    version: 1,
    command: "turn",
    tenant: "headless-demo",
    sessionId: started.session.id,
    turnId: "inline-fault-after-checkpoint",
    text: "Hola, muéstrame el menú",
  });
  assert.equal(turn.status, "indeterminate", JSON.stringify(turn));
  assert.equal(checkpointManifest?.operationTypes[0], "show_menu");

  const inspected = await executeHeadlessCommand(context, { version: 1, command: "inspect", tenant: "headless-demo", sessionId: started.session.id });
  assert.equal(inspected.turn?.state, "indeterminate");
  assert.equal(inspected.after?.draft, null);
  assert.equal(inspected.after?.order, null);
  assert.equal(inspected.responses.length, 0);
});

test("a failure after a durable draft mutation remains indeterminate without replay", { skip: process.env.HEADLESS_SUPABASE_INTEGRATION !== "1" }, async () => {
  let generationCalls = 0;
  let observedEffect;
  const context = await createIntegrationContext({
    semanticGeneration: {
      provider: "test_double:inline",
      generate: async ({ context: semanticContext }) => {
        generationCalls += 1;
        const menuItem = semanticContext.menu.find((item) => item.name?.toLocaleLowerCase("es-CO").includes("hamburguesa"));
        assert.ok(menuItem?.menuItemId, "the local test tenant must expose a hamburger menu item");
        return { confidence: 1, operations: [{ type: "add_product", menuItemId: menuItem.menuItemId, quantity: 1 }] };
      },
    },
    afterEffect: async (effect) => {
      if (effect.type !== "draft_order_mutation") return;
      observedEffect = effect;
      throw new Error("injected_after_draft_mutation");
    },
  });
  const started = await executeHeadlessCommand(context, { version: 1, command: "start", tenant: "headless-demo" });
  assert.equal(started.status, "started", JSON.stringify(started));
  const turn = await executeHeadlessCommand(context, {
    version: 1,
    command: "turn",
    tenant: "headless-demo",
    sessionId: started.session.id,
    turnId: "inline-fault-after-draft",
    text: "Quiero una hamburguesa clásica",
  });
  assert.equal(turn.status, "indeterminate", JSON.stringify(turn));
  assert.equal(observedEffect?.type, "draft_order_mutation");
  assert.equal(typeof observedEffect?.id, "string");

  const inspected = await executeHeadlessCommand(context, { version: 1, command: "inspect", tenant: "headless-demo", sessionId: started.session.id });
  assert.equal(inspected.turn?.state, "indeterminate");
  assert.ok((inspected.after?.draft?.itemCount ?? 0) > 0, JSON.stringify(inspected.after));

  const reconciled = await executeHeadlessCommand(context, {
    version: 1,
    command: "reconcile",
    tenant: "headless-demo",
    sessionId: started.session.id,
    turnId: "inline-fault-after-draft",
    observedOutcome: "effects_applied",
  });
  assert.equal(reconciled.status, "indeterminate", JSON.stringify(reconciled));

  const repeated = await executeHeadlessCommand(context, {
    version: 1,
    command: "turn",
    tenant: "headless-demo",
    sessionId: started.session.id,
    turnId: "inline-fault-after-draft",
    text: "Quiero una hamburguesa clásica",
  });
  assert.equal(repeated.status, "indeterminate", JSON.stringify(repeated));
  assert.equal(generationCalls, 1);
});

test("a failure after a conversation mutation remains indeterminate without replay", { skip: process.env.HEADLESS_SUPABASE_INTEGRATION !== "1" }, async () => {
  let generationCalls = 0;
  let observedEffect;
  const context = await createIntegrationContext({
    semanticGeneration: {
      provider: "test_double:inline",
      generate: async ({ context: semanticContext }) => {
        generationCalls += 1;
        const menuItem = semanticContext.menu.find((item) => item.name?.toLocaleLowerCase("es-CO").includes("hamburguesa"));
        assert.ok(menuItem?.menuItemId, "the local test tenant must expose a hamburger menu item");
        return { confidence: 1, operations: [{ type: "add_product", menuItemId: menuItem.menuItemId, quantity: 1 }] };
      },
    },
    afterEffect: async (effect) => {
      if (effect.type !== "conversation_mutation") return;
      observedEffect = effect;
      throw new Error("injected_after_conversation_mutation");
    },
  });
  const started = await executeHeadlessCommand(context, { version: 1, command: "start", tenant: "headless-demo" });
  assert.equal(started.status, "started", JSON.stringify(started));

  const turn = await executeHeadlessCommand(context, {
    version: 1,
    command: "turn",
    tenant: "headless-demo",
    sessionId: started.session.id,
    turnId: "inline-fault-after-conversation",
    text: "Quiero una hamburguesa clásica",
  });
  assert.equal(turn.status, "indeterminate", JSON.stringify(turn));
  assert.equal(observedEffect?.type, "conversation_mutation");

  const inspected = await executeHeadlessCommand(context, { version: 1, command: "inspect", tenant: "headless-demo", sessionId: started.session.id });
  assert.equal(inspected.turn?.state, "indeterminate");
  assert.ok((inspected.after?.draft?.itemCount ?? 0) > 0, JSON.stringify(inspected.after));
  assert.equal(inspected.after?.conversation?.state, "awaiting_more_items");

  const repeated = await executeHeadlessCommand(context, {
    version: 1,
    command: "turn",
    tenant: "headless-demo",
    sessionId: started.session.id,
    turnId: "inline-fault-after-conversation",
    text: "Quiero una hamburguesa clásica",
  });
  assert.equal(repeated.status, "indeterminate", JSON.stringify(repeated));
  assert.equal(generationCalls, 1);
});

test("manual headless messages resume exactly once through the dashboard service", { skip: process.env.HEADLESS_SUPABASE_INTEGRATION !== "1" }, async () => {
  let generationCalls = 0;
  const generatedMessages = [];
  const context = await createIntegrationContext({
    semanticGeneration: {
      provider: "test_double:inline",
      generate: async ({ rawMessage }) => {
        generationCalls += 1;
        generatedMessages.push(rawMessage);
        return { confidence: 1, operations: [{ type: "show_menu" }] };
      },
    },
  });
  const started = await executeHeadlessCommand(context, { version: 1, command: "start", tenant: "headless-demo" });
  assert.equal(started.status, "started", JSON.stringify(started));
  const session = (await context.journal.read()).sessions.find((candidate) => candidate.id === started.session.id);
  assert.ok(session?.conversationId);
  const schemaName = "tenant_headless_demo";
  const conversationRow = await selectConversationById({ env: context.env, schemaName, conversationId: session.conversationId });
  assert.ok(conversationRow);
  const paused = await pauseConversationAutomation({
    env: context.env,
    schemaName,
    conversation: mapConversationRow(conversationRow),
    manualReason: "test_pause",
    changedBy: "00000000-0000-0000-0000-000000000001",
  });
  assert.equal(paused.state, "manual");

  const first = await executeHeadlessCommand(context, {
    version: 1,
    command: "turn",
    tenant: "headless-demo",
    sessionId: started.session.id,
    turnId: "inline-manual-001",
    text: "Quiero una hamburguesa clásica",
  });
  const latest = await executeHeadlessCommand(context, {
    version: 1,
    command: "turn",
    tenant: "headless-demo",
    sessionId: started.session.id,
    turnId: "inline-manual-002",
    text: "Hola, muéstrame el menú",
  });
  assert.equal(first.status, "pending", JSON.stringify(first));
  assert.equal(latest.status, "pending", JSON.stringify(latest));
  assert.equal(generationCalls, 0);

  const currentRow = await selectConversationById({ env: context.env, schemaName, conversationId: session.conversationId });
  assert.ok(currentRow?.updated_at);
  const resumed = await changeConversationAutomation({
    env: context.env,
    schemaName,
    conversationId: session.conversationId,
    enabled: true,
    expectedUpdatedAt: currentRow.updated_at,
    changedBy: "00000000-0000-0000-0000-000000000001",
    semanticGeneration: context.semanticGeneration,
  });
  assert.notEqual(resumed.state, "manual");
  assert.equal(generationCalls, 1);
  assert.deepEqual(generatedMessages, ["Hola, muéstrame el menú"]);

  const messageRows = await createSupabaseRestClient(context.env).select({
    schema: schemaName,
    table: "messages",
    query: {
      select: "provider_message_id,status,payload",
      conversation_id: `eq.${session.conversationId}`,
      provider: "eq.headless",
      direction: "eq.inbound",
      order: "created_at.asc,id.asc",
    },
  });
  const manualRows = messageRows.filter((row) => ["inline-manual-001", "inline-manual-002"].some((id) => row.provider_message_id?.endsWith(`:${id}`)));
  assert.equal(manualRows.length, 2);
  assert.equal(manualRows[0].status, "superseded");
  assert.equal(manualRows[1].status, "processed");

  const inspected = await executeHeadlessCommand(context, { version: 1, command: "inspect", tenant: "headless-demo", sessionId: started.session.id });
  assert.equal(inspected.status, "inspected");
  assert.ok(inspected.responses.some((response) => response.captureContext === "manual_resume"));
});

test("a failure after order creation remains indeterminate and does not confirm twice", { skip: process.env.HEADLESS_SUPABASE_INTEGRATION !== "1" }, async () => {
  let generationCalls = 0;
  let observedOrderEffect;
  const context = await createIntegrationContext({
    semanticGeneration: {
      provider: "test_double:inline",
      generate: async ({ rawMessage, context: semanticContext }) => {
        generationCalls += 1;
        const normalized = rawMessage.toLocaleLowerCase("es-CO");
        if (normalized.includes("hamburguesa")) {
          const menuItem = semanticContext.menu.find((item) => item.name?.toLocaleLowerCase("es-CO").includes("hamburguesa"));
          assert.ok(menuItem?.menuItemId);
          return { confidence: 1, operations: [{ type: "add_product", menuItemId: menuItem.menuItemId, quantity: 1 }] };
        }
        if (normalized.includes("recoger")) return { confidence: 1, operations: [{ type: "set_fulfillment", fulfillmentType: "pickup" }] };
        if (normalized.includes("nombre")) return { confidence: 1, operations: [{ type: "set_billing", billing: { type: "normal", fullName: "Cliente Fault" } }] };
        if (normalized.includes("transferencia")) return { confidence: 1, operations: [{ type: "set_payment_method", paymentMethod: "transfer" }] };
        return { confidence: 1, operations: [{ type: "confirm_order" }] };
      },
    },
    afterEffect: async (effect) => {
      if (effect.type !== "order_mutation") return;
      observedOrderEffect = effect;
      throw new Error("injected_after_order_mutation");
    },
  });
  const started = await executeHeadlessCommand(context, { version: 1, command: "start", tenant: "headless-demo" });
  assert.equal(started.status, "started", JSON.stringify(started));
  const turns = [
    ["inline-order-fault-001", "Quiero una hamburguesa clásica"],
    ["inline-order-fault-002", "Prefiero recogerlo en el local"],
    ["inline-order-fault-003", "Mi nombre completo es Cliente Fault"],
    ["inline-order-fault-004", "Quiero pagar por transferencia"],
  ];
  for (const [turnId, text] of turns) {
    const result = await executeHeadlessCommand(context, { version: 1, command: "turn", tenant: "headless-demo", sessionId: started.session.id, turnId, text });
    assert.equal(result.status, "applied", JSON.stringify(result));
  }

  const confirmation = await executeHeadlessCommand(context, {
    version: 1,
    command: "turn",
    tenant: "headless-demo",
    sessionId: started.session.id,
    turnId: "inline-order-fault-005",
    text: "Sí, confirma el pedido",
  });
  assert.equal(confirmation.status, "indeterminate", JSON.stringify(confirmation));
  assert.equal(observedOrderEffect?.type, "order_mutation");
  const inspected = await executeHeadlessCommand(context, { version: 1, command: "inspect", tenant: "headless-demo", sessionId: started.session.id });
  assert.equal(inspected.turn?.state, "indeterminate");
  assert.equal(inspected.after?.order?.state, "pending_restaurant_confirmation");
  assert.equal(generationCalls, 5);

  const repeated = await executeHeadlessCommand(context, {
    version: 1,
    command: "turn",
    tenant: "headless-demo",
    sessionId: started.session.id,
    turnId: "inline-order-fault-005",
    text: "Sí, confirma el pedido",
  });
  assert.equal(repeated.status, "indeterminate", JSON.stringify(repeated));
  assert.equal(generationCalls, 5);
});

async function createIntegrationContext(options = {}) {
  const [envText, configText] = await Promise.all([
    readFile(new URL("../.env.headless.local", import.meta.url), "utf8"),
    readFile(new URL("../../../supabase/config.toml", import.meta.url), "utf8"),
  ]);
  return {
    env: parseLocalEnv(envText),
    configText,
    journal: createMemoryJournalStore(),
    semanticGeneration: options.semanticGeneration ?? {
      provider: "test_double:inline",
      generate: async () => ({ confidence: 1, operations: [{ type: "show_menu" }] }),
    },
    beforeCheckpoint: options.beforeCheckpoint,
    afterCheckpoint: options.afterCheckpoint,
    afterEffect: options.afterEffect,
  };
}

function parseLocalEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return {
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
    OPENROUTER_API_KEY: values.OPENROUTER_API_KEY,
    OPENROUTER_MODEL: values.OPENROUTER_MODEL,
  };
}
