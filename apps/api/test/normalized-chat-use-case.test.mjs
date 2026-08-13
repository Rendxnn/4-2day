import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { processNormalizedChatTurn } from "../src/features/chat-routing/process-normalized-chat-turn.ts";
import { loadActiveDraftOrder } from "../src/features/draft-orders/service.ts";
import { executeHeadlessCommand } from "../src/features/headless-chat/application.ts";
import { createMemoryJournalStore } from "../src/features/headless-chat/session-journal.ts";
import { resolveHeadlessTenant } from "../src/features/headless-chat/tenant.ts";
import { selectConversationById } from "../src/features/conversations/repository.ts";
import { mapConversationRow } from "../src/features/conversations/mappers.ts";

test("the normalized boundary gives WhatsApp and headless the same business result", { skip: process.env.HEADLESS_SUPABASE_INTEGRATION !== "1" }, async () => {
  const { env, configText } = await readLocalContext();
  const tenant = await resolveHeadlessTenant({
    env,
    slug: "headless-demo",
    exposedSchemas: ["control", "tenant_template", "tenant_headless_demo", "tenant_headless_isolation_b"],
  });
  const semanticGeneration = createMenuAndProductGenerator();
  const runId = randomUUID().replaceAll("-", "").slice(0, 12);

  const whatsapp = await createSession({ env, configText, semanticGeneration });
  const headless = await createSession({ env, configText, semanticGeneration });

  const whatsappMenu = await processWhatsAppTurn({
    env,
    tenant,
    session: whatsapp,
    semanticGeneration,
    providerMessageId: `normalized-whatsapp-menu-${runId}`,
    text: "Hola, muéstrame el menú",
  });
  const headlessMenu = await executeHeadlessCommand(headless.context, {
    version: 1,
    command: "turn",
    tenant: "headless-demo",
    sessionId: headless.sessionId,
    turnId: `normalized-headless-menu-${runId}`,
    text: "Hola, muéstrame el menú",
  });

  assert.equal(headlessMenu.status, "applied", JSON.stringify(headlessMenu));
  assert.equal(whatsappMenu.routingTrace.llm?.operationTypes?.[0], "show_menu");
  assert.deepEqual(whatsappMenu.responses, headlessMenu.responses.map((response) => response.text));
  assert.equal(headlessMenu.routing?.ai?.operationTypes?.[0], "show_menu");

  const whatsappProduct = await processWhatsAppTurn({
    env,
    tenant,
    session: whatsapp,
    semanticGeneration,
    providerMessageId: `normalized-whatsapp-product-${runId}`,
    text: "Quiero una hamburguesa clásica",
  });
  const headlessProduct = await executeHeadlessCommand(headless.context, {
    version: 1,
    command: "turn",
    tenant: "headless-demo",
    sessionId: headless.sessionId,
    turnId: `normalized-headless-product-${runId}`,
    text: "Quiero una hamburguesa clásica",
  });

  assert.equal(headlessProduct.status, "applied", JSON.stringify(headlessProduct));
  assert.equal(whatsappProduct.routingTrace.llm?.operationTypes?.[0], "add_product");
  assert.deepEqual(whatsappProduct.responses, headlessProduct.responses.map((response) => response.text));
  assert.equal(headlessProduct.routing?.ai?.operationTypes?.[0], "add_product");

  const whatsappAfter = await readBusinessState(env, whatsapp.conversationId);
  const headlessAfter = headlessProduct.after;
  assert.equal(whatsappAfter.conversation.state, headlessAfter?.conversation?.state);
  assert.equal(whatsappAfter.draft?.itemCount, headlessAfter?.draft?.itemCount);
  assert.equal(whatsappAfter.draft?.total, headlessAfter?.draft?.total);
  assert.equal(whatsappAfter.order, null);
  assert.equal(headlessAfter?.order, null);
});

async function createSession(input) {
  const context = {
    env: input.env,
    configText: input.configText,
    journal: createMemoryJournalStore(),
    semanticGeneration: input.semanticGeneration,
  };
  const started = await executeHeadlessCommand(context, { version: 1, command: "start", tenant: "headless-demo" });
  assert.equal(started.status, "started", JSON.stringify(started));
  const journal = await context.journal.read();
  const session = journal.sessions.find((candidate) => candidate.id === started.session.id);
  assert.ok(session?.conversationId);
  return { context, sessionId: started.session.id, conversationId: session.conversationId };
}

async function processWhatsAppTurn(input) {
  const row = await selectConversationById({
    env: input.env,
    schemaName: input.tenant.schemaName,
    conversationId: input.session.conversationId,
  });
  assert.ok(row);
  const responses = [];
  const routingInput = {
    env: input.env,
    tenant: input.tenant,
    conversation: mapConversationRow(row),
    message: {
      provider: "whatsapp_cloud",
      providerMessageId: input.providerMessageId,
      phoneNumberId: "normalized-test",
      from: "normalized-test-customer",
      type: "text",
      text: input.text,
      raw: { source: "normalized-test" },
    },
    traceId: `normalized-${input.providerMessageId}`,
    source: "whatsapp_cloud",
    semanticGeneration: input.semanticGeneration,
    delivery: {
      async sendText(deliveryInput) {
        responses.push(deliveryInput.text);
        return { result: { ok: true, httpStatus: 200, providerMessageId: `fake:${input.providerMessageId}`, raw: {} } };
      },
    },
  };
  await processNormalizedChatTurn(routingInput);
  return { responses, routingTrace: routingInput.routingTrace };
}

async function readBusinessState(env, conversationId) {
  const row = await selectConversationById({ env, schemaName: "tenant_headless_demo", conversationId });
  assert.ok(row);
  const conversation = mapConversationRow(row);
  const draft = await loadActiveDraftOrder({ env, schemaName: "tenant_headless_demo", conversation });
  return {
    conversation,
    draft: draft
      ? { itemCount: draft.items.length, total: draft.total }
      : null,
    order: null,
  };
}

function createMenuAndProductGenerator() {
  return {
    provider: "test_double:inline",
    generate: async ({ rawMessage, context }) => {
      const normalized = rawMessage.toLocaleLowerCase("es-CO");
      if (normalized.includes("menú") || normalized.includes("menu")) {
        return { confidence: 1, operations: [{ type: "show_menu" }] };
      }
      const menuItem = context.menu.find((item) => item.name?.toLocaleLowerCase("es-CO").includes("hamburguesa"));
      assert.ok(menuItem?.menuItemId, "the local test tenant must expose a hamburger menu item");
      return { confidence: 1, operations: [{ type: "add_product", menuItemId: menuItem.menuItemId, quantity: 1 }] };
    },
  };
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
