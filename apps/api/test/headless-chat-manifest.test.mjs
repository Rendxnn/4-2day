import assert from "node:assert/strict";
import test from "node:test";
import { buildPostconditionFingerprints } from "../src/features/chat-routing/semantic/execution-manifest.ts";

const base = {
  operationTypes: ["add_product"],
  canonicalIds: ["menu-item-1"],
  idempotencyKeys: ["headless:session:turn-1"],
  preconditions: ["conversation.state:awaiting_more_items"],
  postconditionKinds: ["conversation.state", "draft_order", "outbound_messages"],
};

test("execution fingerprints bind validated postcondition values, not only operation names", async () => {
  const pickup = await buildPostconditionFingerprints({
    ...base,
    expectation: {
      conversationState: "awaiting_confirmation",
      draft: { id: "draft-1", itemCount: 1, total: 18000, fulfillment: "pickup", payment: null },
      responseExpected: true,
    },
  });
  const delivery = await buildPostconditionFingerprints({
    ...base,
    expectation: {
      conversationState: "awaiting_address",
      draft: { id: "draft-1", itemCount: 1, total: 19000, fulfillment: "delivery", payment: null },
      responseExpected: true,
    },
  });

  assert.equal(pickup.length, 3);
  assert.notDeepEqual(pickup, delivery);
  assert.ok(pickup.every((fingerprint) => /^[^:]+:[a-f0-9]{64}$/.test(fingerprint)));
});
