import type { CapturedResponse } from "../chat-routing/ports";

export type JournalTurn = {
  id: string;
  digest: string;
  state: "claimed" | "processing" | "pending" | "applied" | "rejected" | "failed" | "indeterminate";
  retriable: boolean;
  inboundMessageId?: string;
  manifestPresent: boolean;
  manifestValid: boolean;
  responses: CapturedResponse[];
  routing?: {
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
  };
  errorCode?: string;
  createdAt: string;
  claimedAt?: string;
  updatedAt?: string;
};

export type JournalSession = {
  id: string;
  tenantId: string;
  tenantSlug: string;
  localProjectId?: string;
  identityId: string;
  customerId: string;
  conversationId: string;
  state: "active" | "closed";
  createdAt: string;
  updatedAt?: string;
  closedAt: string | null;
  lastTurnId?: string | null;
  activeTurnId?: string | null;
  activeTurnClaimedAt?: string | null;
  turns: JournalTurn[];
};

export type HeadlessIdentity = {
  id: string;
  tenantId: string;
  tenantSlug?: string;
  localProjectId?: string;
  origin?: "headless";
  customerId: string;
  createdAt: string;
};

export type JournalFile = {
  version: 1;
  identities: HeadlessIdentity[];
  sessions: JournalSession[];
};

export type JournalStore = {
  read: () => Promise<JournalFile>;
  write: (journal: JournalFile) => Promise<void>;
  update?: <T>(update: (journal: JournalFile) => T | Promise<T>) => Promise<T>;
  withSessionLock?: <T>(sessionId: string, operation: () => Promise<T>) => Promise<T>;
};

export function emptyJournal(): JournalFile {
  return { version: 1, identities: [], sessions: [] };
}

export function createMemoryJournalStore(initial = emptyJournal()): JournalStore {
  let journal = validateJournal(initial);
  let queue = Promise.resolve();
  const sessionQueues = new Map<string, Promise<void>>();
  return {
    async read() {
      return structuredClone(journal);
    },
    async write(next) {
      journal = validateJournal(next);
    },
    async update(update) {
      const run = queue.then(async () => {
        const next = structuredClone(journal);
        const value = await update(next);
        journal = validateJournal(next);
        return value;
      });
      queue = run.then(() => undefined, () => undefined);
      return run;
    },
    async withSessionLock(sessionId, operation) {
      const previous = sessionQueues.get(sessionId) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>((resolve) => { release = resolve; });
      sessionQueues.set(sessionId, current);
      await previous;
      try {
        return await operation();
      } finally {
        release();
        if (sessionQueues.get(sessionId) === current) sessionQueues.delete(sessionId);
      }
    },
  };
}

export async function updateJournal<T>(store: JournalStore, update: (journal: JournalFile) => T | Promise<T>): Promise<T> {
  if (store.update) return store.update((journal) => update(validateJournal(journal)));
  const journal = await store.read();
  const next = validateJournal(journal);
  const value = await update(next);
  await store.write(validateJournal(next));
  return value;
}

export function validateJournal(value: unknown): JournalFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JOURNAL_INVALID");
  const journal = value as Partial<JournalFile>;
  if (journal.version !== 1 || !Array.isArray(journal.identities) || !Array.isArray(journal.sessions)) {
    throw new Error("JOURNAL_INVALID_VERSION");
  }
  const identityIds = new Set<string>();
  for (const identity of journal.identities) {
    if (!identity || typeof identity !== "object" || typeof identity.id !== "string" || typeof identity.tenantId !== "string" || typeof identity.customerId !== "string") {
      throw new Error("JOURNAL_INVALID_IDENTITY");
    }
    if (identityIds.has(identity.id)) throw new Error("JOURNAL_DUPLICATE_IDENTITY");
    identityIds.add(identity.id);
    if (identity.origin !== undefined && identity.origin !== "headless") throw new Error("JOURNAL_INVALID_IDENTITY_ORIGIN");
  }
  const sessionIds = new Set<string>();
  for (const session of journal.sessions) {
    if (!session || typeof session !== "object" || typeof session.id !== "string" || typeof session.tenantId !== "string" || typeof session.identityId !== "string" || typeof session.customerId !== "string" || typeof session.conversationId !== "string" || !["active", "closed"].includes(session.state) || !Array.isArray(session.turns)) {
      throw new Error("JOURNAL_INVALID_SESSION");
    }
    if (sessionIds.has(session.id)) throw new Error("JOURNAL_DUPLICATE_SESSION");
    sessionIds.add(session.id);
    if (session.state === "closed" && !session.closedAt) throw new Error("JOURNAL_INVALID_SESSION_STATE");
    if (session.state === "active" && session.closedAt) throw new Error("JOURNAL_INVALID_SESSION_STATE");
    const identity = journal.identities.find((candidate) => candidate.id === session.identityId);
    if (!identity || identity.tenantId !== session.tenantId || identity.customerId !== session.customerId) {
      throw new Error("JOURNAL_IDENTITY_TENANT_MISMATCH");
    }
    const turnIds = new Set<string>();
    for (const turn of session.turns) {
      if (!turn || typeof turn !== "object" || typeof turn.id !== "string" || typeof turn.digest !== "string" || !["claimed", "processing", "pending", "applied", "rejected", "failed", "indeterminate"].includes(turn.state) || typeof turn.retriable !== "boolean" || typeof turn.manifestPresent !== "boolean" || typeof turn.manifestValid !== "boolean" || !Array.isArray(turn.responses)) {
        throw new Error("JOURNAL_INVALID_TURN");
      }
      if (turnIds.has(turn.id)) throw new Error("JOURNAL_DUPLICATE_TURN");
      turnIds.add(turn.id);
      if ((turn.state === "claimed" || turn.state === "processing") && session.activeTurnId && session.activeTurnId !== turn.id) {
        throw new Error("JOURNAL_MULTIPLE_ACTIVE_TURNS");
      }
    }
    if (session.activeTurnId && !session.turns.some((turn) => turn.id === session.activeTurnId && ["claimed", "processing"].includes(turn.state))) {
      throw new Error("JOURNAL_INVALID_ACTIVE_TURN");
    }
  }
  return journal as JournalFile;
}

export function findSession(journal: JournalFile, sessionId: string, tenantId: string): JournalSession | undefined {
  return journal.sessions.find((session) => session.id === sessionId && session.tenantId === tenantId);
}

export function findIdentity(journal: JournalFile, identityId: string, tenantId: string): HeadlessIdentity | undefined {
  return journal.identities.find((identity) => identity.id === identityId && identity.tenantId === tenantId);
}

/**
 * Mark a turn whose owner disappeared as indeterminate once its claim is stale.
 * The journal records the uncertainty; reconciliation remains the only authority
 * allowed to resolve the turn after effects may have started.
 */
export function recoverStaleActiveTurn(
  session: JournalSession,
  now = Date.now(),
  staleAfterMs = 120_000,
): boolean {
  if (!session.activeTurnId) return false;
  const turn = session.turns.find((candidate) => candidate.id === session.activeTurnId);
  if (!turn || !["claimed", "processing"].includes(turn.state)) return false;
  const claimedAt = Date.parse(session.activeTurnClaimedAt ?? turn.claimedAt ?? "");
  if (Number.isFinite(claimedAt) && now - claimedAt < staleAfterMs) return false;

  turn.state = "indeterminate";
  turn.retriable = false;
  turn.errorCode = "TURN_INDETERMINATE";
  turn.updatedAt = new Date(now).toISOString();
  session.activeTurnId = null;
  session.activeTurnClaimedAt = null;
  session.updatedAt = new Date(now).toISOString();
  return true;
}
