export type ReconciliationObservation = "effects_applied" | "no_effects";
export type ReconciliationOutcome = "applied" | "failed" | "indeterminate";

export type ReconciliationEvidence = {
  manifestPresent: boolean;
  manifestValid: boolean;
  allPostconditionsSatisfied: boolean;
  noPostconditionsSatisfied: boolean;
  partialEffects: boolean;
};

export function deriveReconciliationEvidence(input: {
  messageStatus: string;
  payload: unknown;
}): ReconciliationEvidence {
  const internal = isRecord(input.payload) && isRecord(input.payload.internal) ? input.payload.internal : undefined;
  const manifest = internal?.execution_manifest;
  const postconditions = internal?.postconditions;
  const manifestPresent = isRecord(manifest);
  const manifestRecord = manifestPresent ? manifest : undefined;
  const manifestValid = isValidManifest(manifestRecord);
  const postconditionsPresent = isRecord(postconditions);
  const effectIdsPresent = postconditionsPresent
    && Array.isArray(postconditions.effectIds)
    && postconditions.effectIds.length > 0
    && postconditions.effectIds.every((id) => typeof id === "string" && id.length > 0);
  const postconditionsMatchManifest = manifestValid && postconditionsPresent
    && effectIdsPresent
    && postconditions.manifestDigest === manifestRecord?.digest
    && arraysEqual(postconditions.postconditionFingerprints, manifestRecord?.postconditionFingerprints);

  return {
    manifestPresent,
    manifestValid,
    allPostconditionsSatisfied: input.messageStatus === "processed" && postconditionsMatchManifest,
    noPostconditionsSatisfied: manifestValid
      && (input.messageStatus === "failed" || input.messageStatus === "processing")
      && !postconditionsPresent,
    partialEffects: input.messageStatus === "processing" && postconditionsPresent,
  };
}

function arraysEqual(left: unknown, right: unknown): boolean {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

export type NormalizedChatReconciliation = {
  outcome: ReconciliationOutcome;
  reasonCode: string;
  replayed: false;
};

/**
 * Decide recovery from authoritative evidence. The observation is advisory and
 * deliberately does not force a terminal state.
 */
export function reconcileNormalizedChatTurn(input: {
  observation: ReconciliationObservation;
  evidence: ReconciliationEvidence;
}): NormalizedChatReconciliation {
  if (!input.evidence.manifestPresent || !input.evidence.manifestValid) {
    return { outcome: "indeterminate", reasonCode: "MANIFEST_UNAVAILABLE", replayed: false };
  }

  if (input.evidence.partialEffects) {
    return { outcome: "indeterminate", reasonCode: "PARTIAL_EFFECTS", replayed: false };
  }

  if (input.evidence.allPostconditionsSatisfied) {
    return { outcome: "applied", reasonCode: "ALL_POSTCONDITIONS_SATISFIED", replayed: false };
  }

  if (input.evidence.noPostconditionsSatisfied && input.observation === "no_effects") {
    return { outcome: "failed", reasonCode: "NO_POSTCONDITIONS_SATISFIED", replayed: false };
  }

  return {
    outcome: "indeterminate",
    reasonCode: input.observation === "effects_applied" ? "OBSERVATION_UNCONFIRMED" : "EVIDENCE_CONTRADICTORY",
    replayed: false,
  };
}

function isValidManifest(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return value.version === 1
    && typeof value.digest === "string"
    && value.digest.length === 64
    && Array.isArray(value.operationTypes)
    && value.operationTypes.every((item) => typeof item === "string")
    && Array.isArray(value.canonicalIds)
    && value.canonicalIds.every((item) => typeof item === "string")
    && Array.isArray(value.idempotencyKeys)
    && value.idempotencyKeys.every((item) => typeof item === "string")
    && Array.isArray(value.preconditions)
    && value.preconditions.every((item) => typeof item === "string")
    && Array.isArray(value.postconditionFingerprints)
    && value.postconditionFingerprints.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
