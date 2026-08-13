import type {
  Conversation,
  NormalizedInboundMessage,
  OutboundMessageResult,
  Tenant,
} from "@42day/types";
import type { ApiBindings } from "../../lib/bindings";

export type ChatTurnSource = "whatsapp_cloud" | "headless";

export type NormalizedChatEffect = {
  type: "outbound_message" | "draft_order_mutation" | "order_mutation" | "conversation_mutation";
  id: string;
  sequence: number;
};

export type HeadlessEffectRecord = {
  type: NormalizedChatEffect["type"];
  id: string;
  status: "captured" | "updated";
};

export type NormalizedChatTurn = {
  env: ApiBindings;
  tenant: Tenant;
  conversation: Conversation;
  message: NormalizedInboundMessage;
  source: ChatTurnSource;
  traceId: string;
  loggedMessageId?: string;
};

export type CapturedResponse = {
  type: "text" | "image";
  text?: string;
  caption?: string;
  delivery: "captured";
  captureContext: "turn" | "manual_resume";
  originatingTurnId?: string;
  redacted: boolean;
  redactionCodes: string[];
};

export type OutboundDeliveryInput = {
  text?: string;
  caption?: string;
  imageUrl?: string;
  captureContext?: "turn" | "manual_resume";
  originatingTurnId?: string;
};

export type OutboundDeliveryPort = {
  sendText: (input: OutboundDeliveryInput & { text: string }) => Promise<{
    result: OutboundMessageResult;
    response?: CapturedResponse;
  }>;
  sendImage?: (input: OutboundDeliveryInput & { imageUrl: string }) => Promise<{
    result: OutboundMessageResult;
    response?: CapturedResponse;
  }>;
};

export type SemanticGenerationInput = {
  rawMessage: string;
  conversationState: Conversation["state"];
  allowedOperations: string[];
  context?: {
    lastAssistantPrompt: string | null;
    pendingAdjustment: { unavailableMenuItemIds: string[] } | null;
    pendingConfiguration: unknown;
    menu: unknown;
    draft: unknown;
  };
};

export type SemanticGenerationPort = {
  generate: (input: SemanticGenerationInput) => Promise<unknown>;
  provider: "test_double" | string;
};

export type ValidatedExecutionManifest = {
  version: 1;
  digest: string;
  operationTypes: string[];
  canonicalIds: string[];
  idempotencyKeys: string[];
  preconditions: string[];
  postconditionFingerprints: string[];
};

export type ClockPort = {
  now: () => Date;
};

export type IdPort = {
  create: (prefix: string) => string;
};

export type SafeTurnObserver = {
  onStage?: (event: {
    stage: string;
    durationMs?: number;
    code?: string;
    correlationId: string;
  }) => void;
  onResponse?: (response: CapturedResponse) => void;
};
