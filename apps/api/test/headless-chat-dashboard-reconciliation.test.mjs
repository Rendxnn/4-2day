import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import test from "node:test";
import { conversationsDashboardRoutes } from "../src/features/dashboard/routes/conversations.ts";
import { executeHeadlessCommand } from "../src/features/headless-chat/application.ts";
import { createMemoryJournalStore } from "../src/features/headless-chat/session-journal.ts";
import { createSupabaseRestClient } from "../src/lib/supabase-rest.ts";

test("dashboard reconciliation uses the same authoritative decision without replay", { skip: process.env.HEADLESS_SUPABASE_INTEGRATION !== "1" }, async () => {
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
      generate: async () => ({ confidence: 1, operations: [{ type: "show_menu" }] }),
    },
    afterEffect: async () => {
      throw new Error("injected_dashboard_reconciliation_fault");
    },
  };
  const started = await executeHeadlessCommand(context, { version: 1, command: "start", tenant: "headless-demo" });
  assert.equal(started.status, "started", JSON.stringify(started));
  const turn = await executeHeadlessCommand(context, {
    version: 1,
    command: "turn",
    tenant: "headless-demo",
    sessionId: started.session.id,
    turnId: "dashboard-reconcile-fault",
    text: "Hola, muéstrame el menú",
  });
  assert.equal(turn.status, "indeterminate", JSON.stringify(turn));

  const journal = await context.journal.read();
  const session = journal.sessions.find((candidate) => candidate.id === started.session.id);
  const currentTurn = session?.turns.find((candidate) => candidate.id === "dashboard-reconcile-fault");
  assert.ok(session?.conversationId);
  assert.ok(currentTurn?.inboundMessageId);

  const [message] = await createSupabaseRestClient(env).select({
    schema: "tenant_headless_demo",
    table: "messages",
    query: { select: "id,created_at", id: `eq.${currentTurn.inboundMessageId}`, limit: 1 },
  });
  assert.ok(message?.created_at);

  const app = new Hono();
  app.use("/*", async (c, next) => {
    c.set("tenant", { schema_name: "tenant_headless_demo" });
    c.set("authUser", { id: "headless-test-dashboard-user" });
    await next();
  });
  app.route("/", conversationsDashboardRoutes);

  const response = await app.request(
    `http://127.0.0.1/demo/conversations/${session.conversationId}/messages/${currentTurn.inboundMessageId}/reconciliation`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ observedOutcome: "effects_applied", expectedUpdatedAt: message.created_at }),
    },
    env,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, {
    status: "indeterminate",
    outcome: "indeterminate",
    reasonCode: "OBSERVATION_UNCONFIRMED",
    messageId: currentTurn.inboundMessageId,
    updatedAt: message.created_at,
  });
});

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
