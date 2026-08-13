import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHeadlessCommand } from "../src/features/headless-chat/contracts.ts";
import { executeHeadlessCommand } from "../src/features/headless-chat/application.ts";
import { createMemoryJournalStore, updateJournal } from "../src/features/headless-chat/session-journal.ts";
import { createSupabaseRestClient } from "../src/lib/supabase-rest.ts";

test("same turn identifier is a valid command and is available for durable digest checks", () => {
  const command = parseHeadlessCommand({ version: 1, command: "turn", tenant: "demo", sessionId: "hss_123456", turnId: "turn-1", text: "hola" });
  assert.equal(command.turnId, "turn-1");
});

test("concurrent journal claims produce one durable turn and reject a conflicting digest", async () => {
  const journal = createMemoryJournalStore();
  await updateJournal(journal, (value) => {
    value.identities.push({ id: "hid_1", tenantId: "tenant", customerId: "customer", createdAt: "2026-08-12T00:00:00.000Z" });
    value.sessions.push({ id: "hss_1", tenantId: "tenant", tenantSlug: "demo", identityId: "hid_1", customerId: "customer", conversationId: "conversation", state: "active", createdAt: "2026-08-12T00:00:00.000Z", closedAt: null, turns: [] });
  });
  const claims = await Promise.all(["digest-a", "digest-a"].map((digest) => updateJournal(journal, (value) => {
    const session = value.sessions[0];
    const existing = session.turns.find((turn) => turn.id === "turn-1");
    if (existing) return "repeated";
    session.turns.push({ id: "turn-1", digest, state: "processing", retriable: false, manifestPresent: false, manifestValid: false, responses: [], createdAt: "2026-08-12T00:00:00.000Z" });
    return "claimed";
  })));
  assert.deepEqual(claims.sort(), ["claimed", "repeated"]);
  await assert.rejects(() => updateJournal(journal, (value) => {
    const turn = value.sessions[0].turns[0];
    if (turn.digest !== "digest-b") throw new Error("IDEMPOTENCY_CONFLICT");
  }), /IDEMPOTENCY_CONFLICT/);
});

test("concurrent local turns with the same id apply once and return a durable repeat", { skip: process.env.HEADLESS_SUPABASE_INTEGRATION !== "1" }, async () => {
  const [envText, configText] = await Promise.all([
    readFile(new URL("../.env.headless.local", import.meta.url), "utf8"),
    readFile(new URL("../../../supabase/config.toml", import.meta.url), "utf8"),
  ]);
  const context = {
    env: parseLocalEnv(envText),
    configText,
    journal: createMemoryJournalStore(),
    semanticGeneration: {
      provider: "test_double:inline",
      generate: async () => ({ confidence: 1, operations: [{ type: "show_menu" }] }),
    },
  };
  const started = await executeHeadlessCommand(context, { version: 1, command: "start", tenant: "headless-demo" });
  assert.equal(started.status, "started", JSON.stringify(started));

  const results = await Promise.all([
    executeHeadlessCommand(context, { version: 1, command: "turn", tenant: "headless-demo", sessionId: started.session.id, turnId: "concurrent-idempotent-turn", text: "Hola, muéstrame el menú" }),
    executeHeadlessCommand(context, { version: 1, command: "turn", tenant: "headless-demo", sessionId: started.session.id, turnId: "concurrent-idempotent-turn", text: "Hola, muéstrame el menú" }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["applied", "repeated"]);

  const journal = await context.journal.read();
  const session = journal.sessions.find((candidate) => candidate.id === started.session.id);
  const rows = await createSupabaseRestClient(context.env).select({
    schema: "tenant_headless_demo",
    table: "messages",
    query: {
      select: "id,provider_message_id,direction",
      conversation_id: `eq.${session.conversationId}`,
      provider: "eq.headless",
    },
  });
  assert.ok(rows.length > 0, JSON.stringify(rows));
  const inboundRows = rows.filter((row) => row.direction === "inbound" && row.provider_message_id?.endsWith(":concurrent-idempotent-turn"));
  const outboundRows = rows.filter((row) => row.direction === "outbound");
  assert.equal(inboundRows.length, 1);
  assert.equal(outboundRows.length, 1);
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
