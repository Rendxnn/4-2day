import assert from "node:assert/strict";
import test from "node:test";
import { reconcileNormalizedChatTurn } from "../src/features/chat-routing/reconcile-normalized-chat-turn.ts";
import { parseSemanticOperationPlan } from "../src/features/chat-routing/semantic/operation-plan.ts";
import { executeHeadlessCommand } from "../src/features/headless-chat/application.ts";
import { createMemoryJournalStore } from "../src/features/headless-chat/session-journal.ts";

test("dependency uncertainty blocks automatic retry", () => {
  const result = reconcileNormalizedChatTurn({ observation: "effects_applied", evidence: { manifestPresent: true, manifestValid: true, allPostconditionsSatisfied: false, noPostconditionsSatisfied: false, partialEffects: true } });
  assert.equal(result.outcome, "indeterminate");
});

test("malformed and low-confidence outputs remain explicit inline test inputs", async () => {
  await assert.rejects(
    () => inferInline({ confidence: 1, operations: [{ type: "invalid" }] }),
    /does not match.*schema|invalid/i,
  );
  const lowConfidence = await inferInline({ confidence: 0.1, operations: [] });
  assert.equal(lowConfidence.confidence, 0.1);
  assert.deepEqual(lowConfidence.operations, []);
});

test("unavailable local dependencies are classified safely and never look like a security failure", async () => {
  const env = {
    APP_ENV: "local",
    PARAHOY_HEADLESS_DEBUG: "true",
    PARAHOY_HEADLESS_LOCAL_PROJECT_ID: "42day",
    SUPABASE_URL: "http://127.0.0.1:59999",
    SUPABASE_SERVICE_ROLE_KEY: "local-test-only",
    META_VERIFY_TOKEN: "",
    META_ACCESS_TOKEN: "",
    META_PHONE_NUMBER_ID: "",
    META_WABA_ID: "",
  };
  const configText = [
    '[project]\nproject_id = "42day"',
    "[api]\nport = 59999\nschemas = [\"control\", \"tenant_template\"]",
    "[db]\nport = 54322",
  ].join("\n");
  const result = await executeHeadlessCommand({ env, configText, journal: createMemoryJournalStore() }, { version: 1, command: "start", tenant: "headless-demo" });
  assert.equal(result.status, "rejected");
  assert.equal(result.error?.code, "DATABASE_UNAVAILABLE");
  assert.equal(result.error?.category, "dependency");
  assert.equal(result.error?.safeMessage, "La dependencia local no está disponible.");
  assert.equal(result.error?.safeMessage.includes("127.0.0.1"), false);
});

function inferInline(response) {
  return parseSemanticOperationPlan({
    env: { APP_ENV: "test", GEMINI_API_KEY: "", SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "test", META_VERIFY_TOKEN: "", META_ACCESS_TOKEN: "", META_PHONE_NUMBER_ID: "", META_WABA_ID: "" },
    tenantId: "tenant",
    traceId: "trace",
    rawMessage: "mensaje de prueba",
    conversation: { state: "awaiting_mode_selection" },
    menu: { items: [] },
    draft: null,
    allowedOperations: ["show_menu"],
    generation: { provider: "test_double:inline", generate: async () => response },
  }).then((execution) => execution.plan);
}
