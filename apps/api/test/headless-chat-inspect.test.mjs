import assert from "node:assert/strict";
import test from "node:test";
import { createConversationSnapshot } from "../src/features/headless-chat/snapshot.ts";
import { projectCapturedResponse } from "../src/features/chat-routing/outbound/capture.ts";
import { deriveReconciliationEvidence, reconcileNormalizedChatTurn } from "../src/features/chat-routing/reconcile-normalized-chat-turn.ts";

test("snapshot is read-only and contains no draft/order PII", () => {
  const conversation = { id: "conversation", customerId: "customer", channel: "whatsapp", state: "new", context: {}, clarificationAttempts: 0, automationEnabled: true, createdAt: "2026-08-12T00:00:00.000Z", updatedAt: "2026-08-12T00:00:00.000Z" };
  const before = structuredClone(conversation);
  const snapshot = createConversationSnapshot(conversation);
  assert.equal(snapshot.draft, null);
  assert.equal(snapshot.order, null);
  assert.deepEqual(conversation, before);
});

test("manual resume projections stay ordered, correlated and captured", () => {
  const first = projectCapturedResponse({ type: "text", text: "Respuesta 1", captureContext: "manual_resume", originatingTurnId: "inbound-1" });
  const second = projectCapturedResponse({ type: "text", text: "Respuesta 2", captureContext: "manual_resume", originatingTurnId: "inbound-2" });
  assert.equal(first.delivery, "captured");
  assert.equal(first.captureContext, "manual_resume");
  assert.equal(first.originatingTurnId, "inbound-1");
  assert.equal(second.originatingTurnId, "inbound-2");
  assert.notEqual(first.originatingTurnId, second.originatingTurnId);
});

test("inspect/reconcile evidence distinguishes valid, corrupt, mismatched and partial turns", () => {
  const manifest = {
    version: 1,
    digest: "a".repeat(64),
    operationTypes: ["show_menu"],
    canonicalIds: [],
    idempotencyKeys: ["headless:turn-1"],
    preconditions: ["conversation.state:awaiting_mode_selection"],
    postconditionFingerprints: ["conversation.state:" + "b".repeat(64)],
  };
  const validPayload = { internal: { execution_manifest: manifest, postconditions: { manifestDigest: manifest.digest, postconditionFingerprints: manifest.postconditionFingerprints, effectIds: ["effect-1"] } } };
  const valid = deriveReconciliationEvidence({ messageStatus: "processed", payload: validPayload });
  assert.equal(reconcileNormalizedChatTurn({ observation: "effects_applied", evidence: valid }).outcome, "applied");
  assert.equal(reconcileNormalizedChatTurn({ observation: "effects_applied", evidence: deriveReconciliationEvidence({ messageStatus: "processing", payload: validPayload }) }).outcome, "indeterminate");
  assert.equal(reconcileNormalizedChatTurn({ observation: "effects_applied", evidence: deriveReconciliationEvidence({ messageStatus: "processed", payload: { internal: { execution_manifest: manifest, postconditions: { ...validPayload.internal.postconditions, postconditionFingerprints: ["conversation.state:" + "c".repeat(64)] } } } }) }).outcome, "indeterminate");
  assert.equal(reconcileNormalizedChatTurn({ observation: "effects_applied", evidence: deriveReconciliationEvidence({ messageStatus: "processed", payload: { internal: { execution_manifest: { ...manifest, version: 2 }, postconditions: {} } } }) }).outcome, "indeterminate");
});
