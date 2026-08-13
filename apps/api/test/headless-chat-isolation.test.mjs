import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertHeadlessSessionBinding, resolveHeadlessTenant } from "../src/features/headless-chat/tenant.ts";
import { createMemoryJournalStore, findSession } from "../src/features/headless-chat/session-journal.ts";
import { executeHeadlessCommand } from "../src/features/headless-chat/application.ts";

test("session lookup is tenant-scoped and does not enumerate another tenant", () => {
  const journal = { version: 1, identities: [], sessions: [{ id: "hss_123456", tenantId: "tenant-a", tenantSlug: "a", identityId: "hid_123456", customerId: "c", conversationId: "conversation", state: "active", createdAt: "2026-08-12T00:00:00.000Z", closedAt: null, turns: [] }] };
  assert.equal(findSession(journal, "hss_123456", "tenant-b"), undefined);
});

test("session binding rejects tenant, project and non-headless identity crossings uniformly", () => {
  const tenantA = { id: "tenant-a", name: "A", slug: "a", schemaName: "tenant_a", status: "active", timezone: "America/Bogota", currency: "COP", automationEnabled: true };
  const tenantB = { ...tenantA, id: "tenant-b", name: "B", slug: "b", schemaName: "tenant_b" };
  const base = {
    version: 1,
    identities: [{ id: "hid_a", tenantId: "tenant-a", tenantSlug: "a", localProjectId: "42day", origin: "headless", customerId: "customer-a", createdAt: "2026-08-12T00:00:00.000Z" }],
    sessions: [{ id: "hss_a", tenantId: "tenant-a", tenantSlug: "a", localProjectId: "42day", identityId: "hid_a", customerId: "customer-a", conversationId: "conversation-a", state: "active", createdAt: "2026-08-12T00:00:00.000Z", closedAt: null, turns: [] }],
  };

  assert.doesNotThrow(() => assertHeadlessSessionBinding({ journal: base, session: base.sessions[0], tenant: tenantA, localProjectId: "42day" }));
  for (const input of [
    { tenant: tenantB, localProjectId: "42day" },
    { tenant: tenantA, localProjectId: "other-project" },
    { tenant: tenantA, localProjectId: "42day", journal: { ...base, identities: [{ ...base.identities[0], origin: "whatsapp" }] } },
  ]) {
    assert.throws(() => assertHeadlessSessionBinding({ journal: input.journal ?? base, session: base.sessions[0], tenant: input.tenant, localProjectId: input.localProjectId }), /SESSION_NOT_FOUND/);
  }
});

test("tenant resolution accepts an inactive registered tenant but rejects an unexposed schema", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([{ id: "tenant-inactive", name: "Inactive", slug: "inactive", schema_name: "tenant_inactive", status: "inactive", timezone: "America/Bogota", currency: "COP", automation_enabled: false }]), { status: 200, headers: { "content-type": "application/json" } });
  const env = { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "local", APP_ENV: "local" };
  try {
    const tenant = await resolveHeadlessTenant({ env, slug: "inactive", exposedSchemas: ["control", "tenant_template", "tenant_inactive"] });
    assert.equal(tenant.status, "inactive");
    await assert.rejects(() => resolveHeadlessTenant({ env, slug: "inactive", exposedSchemas: ["control", "tenant_template"] }), /UNAUTHORIZED_TARGET_ENV/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("local Supabase rejects cross-tenant sessions and identities without enumeration", { skip: process.env.HEADLESS_SUPABASE_INTEGRATION !== "1" }, async () => {
  const [envText, configText] = await Promise.all([
    readFile(new URL("../.env.headless.local", import.meta.url), "utf8"),
    readFile(new URL("../../../supabase/config.toml", import.meta.url), "utf8"),
  ]);
  const env = parseLocalEnv(envText);
  const journal = createMemoryJournalStore();
  const context = { env, configText, journal };
  const first = await executeHeadlessCommand(context, { version: 1, command: "start", tenant: "headless-demo" });
  const second = await executeHeadlessCommand(context, { version: 1, command: "start", tenant: "headless-isolation-b" });
  assert.equal(first.status, "started", JSON.stringify(first));
  assert.equal(second.status, "started", JSON.stringify(second));

  const firstSessionId = first.session?.id;
  const firstIdentityId = first.session?.identityId;
  assert.ok(firstSessionId);
  assert.ok(firstIdentityId);

  const crossedTurn = await executeHeadlessCommand(context, {
    version: 1,
    command: "turn",
    tenant: "headless-isolation-b",
    sessionId: firstSessionId,
    turnId: "cross-tenant-turn",
    text: "No debe procesarse",
  });
  assert.equal(crossedTurn.status, "rejected");
  assert.equal(crossedTurn.error?.code, "SESSION_NOT_FOUND");

  const crossedIdentity = await executeHeadlessCommand(context, {
    version: 1,
    command: "start",
    tenant: "headless-isolation-b",
    identityId: firstIdentityId,
  });
  assert.equal(crossedIdentity.status, "rejected");
  assert.equal(crossedIdentity.error?.code, "IDENTITY_NOT_FOUND");
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
