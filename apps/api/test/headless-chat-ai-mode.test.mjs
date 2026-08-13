import assert from "node:assert/strict";
import test from "node:test";
import { parseHeadlessCommand } from "../src/features/headless-chat/contracts.ts";
import { parseSemanticOperationPlan } from "../src/features/chat-routing/semantic/operation-plan.ts";

test("the operational headless CLI always selects the real tenant provider", () => {
  assert.throws(() => parseHeadlessCommand({
    version: 1,
    command: "turn",
    tenant: "demo",
    sessionId: "hss_123456",
    turnId: "turn-1",
    text: "hola",
    aiFixtureId: "forbidden-test-selector",
  }), /INVALID_COMMAND/);
});

test("the shared parser accepts only an explicitly injected test double outside the CLI", async () => {
  const response = { confidence: 1, operations: [{ type: "show_menu" }] };
  const execution = await parseSemanticOperationPlan({
    env: { APP_ENV: "test", GEMINI_API_KEY: "", SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "test", META_VERIFY_TOKEN: "", META_ACCESS_TOKEN: "", META_PHONE_NUMBER_ID: "", META_WABA_ID: "" },
    tenantId: "tenant",
    traceId: "trace",
    rawMessage: "menu",
    conversation: { state: "awaiting_mode_selection" },
    menu: { items: [] },
    draft: null,
    allowedOperations: ["show_menu"],
    generation: { provider: "test_double:inline", generate: async () => response },
  });

  assert.equal(execution.providerId, "test_double");
  assert.deepEqual(execution.plan, response);
});
