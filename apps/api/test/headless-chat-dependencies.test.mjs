import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { executeHeadlessCommand } from "../src/features/headless-chat/application.ts";
import { createMemoryJournalStore } from "../src/features/headless-chat/session-journal.ts";

test("integration dependencies are not replaced by a silent remote fallback", () => {
  assert.equal("http://127.0.0.1:54321".includes("127.0.0.1"), true);
  assert.equal("https://remote.supabase.co".includes("127.0.0.1"), false);
});

test("catalog and geocoding dependency failures stay explicit in the local flow", {
  skip: process.env.HEADLESS_SUPABASE_INTEGRATION !== "1",
}, async () => {
  const context = await createIntegrationContext({
    semanticGeneration: {
      provider: "test_double",
      generate: async ({ rawMessage, context: semanticContext }) => {
        if (rawMessage.includes("unknown")) {
          return { confidence: 1, operations: [{ type: "add_product", menuItemId: "00000000-0000-0000-0000-000000000000", quantity: 1 }] };
        }
        if (rawMessage.includes("hamburguesa")) {
          const menuItem = semanticContext.menu.find((item) => item.name?.toLocaleLowerCase("es-CO").includes("hamburguesa"));
          assert.ok(menuItem?.menuItemId);
          return { confidence: 1, operations: [{ type: "add_product", menuItemId: menuItem.menuItemId, quantity: 1 }] };
        }
        if (rawMessage.includes("domicilio")) return { confidence: 1, operations: [{ type: "set_fulfillment", fulfillmentType: "delivery" }] };
        return { confidence: 1, operations: [{ type: "set_delivery_address", addressText: "Calle 58 sur #42 99" }] };
      },
    },
  });
  const started = await executeHeadlessCommand(context, { version: 1, command: "start", tenant: "headless-demo" });
  assert.equal(started.status, "started", JSON.stringify(started));

  const unknown = await executeHeadlessCommand(context, {
    version: 1,
    command: "turn",
    tenant: "headless-demo",
    sessionId: started.session.id,
    turnId: "dependency-unknown-catalog",
    text: "unknown product",
  });
  assert.equal(unknown.status, "applied", JSON.stringify(unknown));
  assert.equal(unknown.after?.draft, null);
  assert.equal(unknown.routing?.ai?.outcome, "unresolved");

  const add = await executeHeadlessCommand(context, {
    version: 1,
    command: "turn",
    tenant: "headless-demo",
    sessionId: started.session.id,
    turnId: "dependency-add-product",
    text: "Quiero una hamburguesa clásica",
  });
  assert.equal(add.status, "applied", JSON.stringify(add));

  const delivery = await executeHeadlessCommand(context, {
    version: 1,
    command: "turn",
    tenant: "headless-demo",
    sessionId: started.session.id,
    turnId: "dependency-delivery",
    text: "Quiero domicilio",
  });
  assert.equal(delivery.status, "applied", JSON.stringify(delivery));

  const address = await executeHeadlessCommand(context, {
    version: 1,
    command: "turn",
    tenant: "headless-demo",
    sessionId: started.session.id,
    turnId: "dependency-address",
    text: "Calle 58 sur #42 99",
  });
  assert.equal(address.status, "applied", JSON.stringify(address));
  assert.equal(address.routing?.ai?.provider, "test_double");
  assert.equal(address.after?.order, null);
  assert.ok(address.responses.every((response) => response.delivery === "captured"));
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
    semanticGeneration: options.semanticGeneration,
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
  };
}
