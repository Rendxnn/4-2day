import assert from "node:assert/strict";
import test from "node:test";
import { deriveReconciliationEvidence, reconcileNormalizedChatTurn } from "../src/features/chat-routing/reconcile-normalized-chat-turn.ts";

test("reconciliation resolves only all or no effects and never replays", () => {
  const applied = reconcileNormalizedChatTurn({ observation: "effects_applied", evidence: { manifestPresent: true, manifestValid: true, allPostconditionsSatisfied: true, noPostconditionsSatisfied: false, partialEffects: false } });
  const failed = reconcileNormalizedChatTurn({ observation: "no_effects", evidence: { manifestPresent: true, manifestValid: true, allPostconditionsSatisfied: false, noPostconditionsSatisfied: true, partialEffects: false } });
  const partial = reconcileNormalizedChatTurn({ observation: "effects_applied", evidence: { manifestPresent: true, manifestValid: true, allPostconditionsSatisfied: false, noPostconditionsSatisfied: false, partialEffects: true } });
  assert.equal(applied.outcome, "applied");
  assert.equal(failed.outcome, "failed");
  assert.equal(partial.outcome, "indeterminate");
  assert.equal(partial.replayed, false);
});

test("no postconditions are failure only with an explicit no-effects observation", () => {
  const evidence = {
    manifestPresent: true,
    manifestValid: true,
    allPostconditionsSatisfied: false,
    noPostconditionsSatisfied: true,
    partialEffects: false,
  };
  assert.equal(reconcileNormalizedChatTurn({ observation: "no_effects", evidence }).outcome, "failed");
  assert.equal(reconcileNormalizedChatTurn({ observation: "effects_applied", evidence }).outcome, "indeterminate");
});

test("authoritative postconditions must bind to the persisted manifest", () => {
  const manifest = {
    version: 1,
    digest: "a".repeat(64),
    operationTypes: ["add_product"],
    canonicalIds: ["menu-1"],
    idempotencyKeys: ["headless:hss_test:turn-1"],
    preconditions: ["conversation.state:awaiting_mode_selection"],
    postconditionFingerprints: ["draft_order:" + "b".repeat(64)],
  };
  const matched = deriveReconciliationEvidence({
    messageStatus: "processed",
    payload: {
      internal: {
        execution_manifest: manifest,
        postconditions: {
          manifestDigest: manifest.digest,
          postconditionFingerprints: manifest.postconditionFingerprints,
          effectIds: ["message-1"],
        },
      },
    },
  });
  const mismatched = deriveReconciliationEvidence({
    messageStatus: "processed",
    payload: {
      internal: {
        execution_manifest: manifest,
        postconditions: {
          manifestDigest: manifest.digest,
          postconditionFingerprints: ["draft_order:" + "c".repeat(64)],
          effectIds: ["message-1"],
        },
      },
    },
  });
  assert.equal(matched.allPostconditionsSatisfied, true);
  assert.equal(mismatched.allPostconditionsSatisfied, false);
});
