import type { Conversation, NormalizedInboundMessage, Tenant } from "@42day/types";
import type { ApiBindings } from "../../../lib/bindings";
import type { SemanticParserResult } from "../../../modules/semantic-parser/semantic-parser";
import type { ChatTurnSource, HeadlessEffectRecord, NormalizedChatEffect, OutboundDeliveryPort, SemanticGenerationPort, ValidatedExecutionManifest } from "../ports";

export type ResponseRoutingTrace = {
  responseSource?: "deterministic" | "llm" | "deterministic_after_llm_fallback";
  responseReason?: string;
  llm?: {
    attempted: boolean;
    used: boolean;
    outcome: "handled" | "skipped_or_failed" | "low_confidence" | "unresolved" | "not_order";
    provider?: "gemini" | "openrouter" | "test_double";
    model?: string;
    reason?: string;
    intent?: SemanticParserResult["intent"];
    confidence?: number;
    itemCount?: number;
    editActionCount?: number;
    parsed?: SemanticParserResult;
    operationTypes?: string[];
    diagnostics?: Record<string, unknown>;
  };
};

export type RouteInboundMessageInput = {
  env: ApiBindings;
  tenant: Tenant;
  conversation: Conversation;
  message: NormalizedInboundMessage;
  traceId: string;
  loggedMessageId?: string;
  source: ChatTurnSource;
  captureContext?: "turn" | "manual_resume";
  originatingTurnId?: string;
  delivery?: OutboundDeliveryPort;
  semanticGeneration?: SemanticGenerationPort;
  beforeFirstEffect?: (manifest: ValidatedExecutionManifest) => Promise<void>;
  afterEffect?: (effect: NormalizedChatEffect) => Promise<void>;
  headlessEffectIds?: string[];
  headlessEffects?: HeadlessEffectRecord[];
  routingTrace?: ResponseRoutingTrace;
};
