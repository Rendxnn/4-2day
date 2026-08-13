import type { CapturedResponse } from "../chat-routing/ports";

export type HeadlessErrorCategory =
  | "input"
  | "security"
  | "tenant"
  | "session"
  | "ai"
  | "dependency"
  | "conflict"
  | "internal";

export type HeadlessResultStatus =
  | "started"
  | "pending"
  | "applied"
  | "repeated"
  | "inspected"
  | "reconciled"
  | "closed"
  | "rejected"
  | "failed"
  | "indeterminate";

export type HeadlessResult = {
  version: 1;
  command: "start" | "turn" | "inspect" | "reconcile" | "close" | "unknown";
  status: HeadlessResultStatus;
  tenant: { id: string; slug: string } | null;
  session: {
    id: string;
    identityId: string;
    state: "active" | "closed";
    createdAt: string;
    closedAt: string | null;
  } | null;
  turn: { id: string; state: "claimed" | "processing" | "pending" | "applied" | "rejected" | "failed" | "indeterminate"; retriable: boolean } | null;
  responses: CapturedResponse[];
  before: SafeSnapshot | null;
  after: SafeSnapshot | null;
  routing: {
    branch: string;
    reasonCode: string;
    ai: {
      attempted: boolean;
      used: boolean;
      provider: string | null;
      model: string | null;
      outcome: string | null;
      operationTypes: string[];
    };
  } | null;
  effects: Array<{ type: string; status: "created" | "updated" | "captured" | "skipped" | "failed"; id: string | null }>;
  warnings: string[];
  error: {
    code: string;
    category: HeadlessErrorCategory;
    retriable: boolean;
    safeMessage: string;
  } | null;
};

export type SafeSnapshot = {
  conversation: {
    id: string;
    state: string;
    automation: string;
    expiry: "active" | "expired" | "unknown";
  } | null;
  draft: {
    id: string;
    state: string;
    itemCount: number;
    subtotal: number;
    deliveryFee: number;
    total: number;
    fulfillment: string | null;
    payment: string | null;
    requiredFieldsComplete: boolean;
  } | null;
  order: {
    id: string;
    state: string;
    total: number;
  } | null;
};

export function createResult(input: {
  command: HeadlessResult["command"];
  status: HeadlessResultStatus;
  tenant?: HeadlessResult["tenant"];
  session?: HeadlessResult["session"];
  turn?: HeadlessResult["turn"];
  responses?: CapturedResponse[];
  before?: SafeSnapshot | null;
  after?: SafeSnapshot | null;
  routing?: HeadlessResult["routing"];
  effects?: HeadlessResult["effects"];
  warnings?: string[];
  error?: HeadlessResult["error"];
}): HeadlessResult {
  return {
    version: 1,
    command: input.command,
    status: input.status,
    tenant: input.tenant ?? null,
    session: input.session ?? null,
    turn: input.turn ?? null,
    responses: input.responses ?? [],
    before: input.before ?? null,
    after: input.after ?? null,
    routing: input.routing ?? null,
    effects: input.effects ?? [],
    warnings: [...new Set(input.warnings ?? [])],
    error: input.error ?? null,
  };
}

export function safeError(input: {
  code: string;
  category: HeadlessErrorCategory;
  retriable?: boolean;
  safeMessage: string;
}): HeadlessResult["error"] {
  return {
    code: input.code,
    category: input.category,
    retriable: input.retriable ?? false,
    safeMessage: input.safeMessage.slice(0, 240),
  };
}
