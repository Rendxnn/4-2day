export type ManifestExpectation = {
  conversationState?: string;
  draft?: {
    id: string | null;
    itemCount: number;
    total: number;
    fulfillment: string | null;
    payment: string | null;
  };
  orderExpected?: boolean;
  responseExpected?: boolean;
};

export async function buildPostconditionFingerprints(input: {
  operationTypes: string[];
  canonicalIds: string[];
  idempotencyKeys: string[];
  preconditions: string[];
  postconditionKinds: string[];
  expectation: ManifestExpectation;
}): Promise<string[]> {
  return Promise.all(input.postconditionKinds.map(async (kind) => {
    const bytes = new TextEncoder().encode(JSON.stringify({
      kind,
      operationTypes: input.operationTypes,
      canonicalIds: input.canonicalIds,
      idempotencyKeys: input.idempotencyKeys,
      preconditions: input.preconditions,
      expectation: input.expectation,
    }));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${kind}:${hex}`;
  }));
}
