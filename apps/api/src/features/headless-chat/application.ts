import type { NormalizedInboundMessage } from "@42day/types";
import { findOrCreateCustomer } from "../../modules/customer-service/customer-service";
import {
  checkpointNormalizedInbound,
  finalizeNormalizedInbound,
  logInboundMessage,
  loadManualResumeCapturedResponses,
  loadRecentConversationMessages,
} from "../../modules/message-log/message-log";
import { selectConversationById } from "../conversations/repository";
import { mapConversationRow } from "../conversations/mappers";
import { conversationNeedsExpiration, loadOrCreateActiveConversation, touchConversationForInbound } from "../conversations/service";
import { createHeadlessCapture, projectCapturedResponse } from "../chat-routing/outbound/capture";
import { processNormalizedChatTurn } from "../chat-routing/process-normalized-chat-turn";
import { deriveReconciliationEvidence, reconcileNormalizedChatTurn } from "../chat-routing/reconcile-normalized-chat-turn";
import { parseHeadlessCommand, type HeadlessCommand } from "./contracts";
import { loadHeadlessSnapshot } from "./snapshot";
import {
  findIdentity,
  findSession,
  recoverStaleActiveTurn,
  updateJournal,
  type JournalSession,
  type JournalStore,
} from "./session-journal";
import { createResult, safeError, type HeadlessResult } from "./result";
import { assertHeadlessSessionBinding, resolveHeadlessTenant, validateHeadlessEnvironment } from "./tenant";
import type { ApiBindings } from "../../lib/bindings";
import { createSupabaseRestClient } from "../../lib/supabase-rest";
import type { HeadlessEffectRecord, NormalizedChatEffect, SemanticGenerationPort, ValidatedExecutionManifest } from "../chat-routing/ports";

export type HeadlessApplicationContext = {
  env: ApiBindings;
  configText: string;
  journal: JournalStore;
  /** Internal test seam only; the CLI never supplies a generation override. */
  semanticGeneration?: SemanticGenerationPort;
  /** Internal fault-injection seam only; the CLI never supplies it. */
  beforeCheckpoint?: (manifest: ValidatedExecutionManifest) => Promise<void>;
  /** Internal fault-injection seam only; the CLI never supplies it. */
  afterCheckpoint?: (manifest: ValidatedExecutionManifest) => Promise<void>;
  /** Internal fault-injection seam only; production CLI never supplies it. */
  afterEffect?: (effect: NormalizedChatEffect) => Promise<void>;
};

export async function executeHeadlessCommand(
  context: HeadlessApplicationContext,
  input: unknown,
): Promise<HeadlessResult> {
  try {
    const headlessEnvironment = validateHeadlessEnvironment({ env: context.env, configText: context.configText });
    const command = parseHeadlessCommand(input);
    const tenant = await resolveHeadlessTenant({ env: context.env, slug: command.tenant, exposedSchemas: headlessEnvironment.schemas });

    switch (command.command) {
      case "start": return await startSession(context, tenant, command);
      case "turn": return await processTurn(context, tenant, command);
      case "inspect": return await inspectSession(context, tenant, command);
      case "reconcile": return await reconcileTurn(context, tenant, command);
      case "close": return await closeSession(context, tenant, command);
    }
  } catch (error: unknown) {
    return createResult({
      command: inferCommand(input),
      status: error instanceof Error && error.message === "TURN_INDETERMINATE" ? "indeterminate" : "rejected",
      error: toSafeError(error),
    });
  }
}

async function startSession(
  context: HeadlessApplicationContext,
  tenant: Awaited<ReturnType<typeof resolveHeadlessTenant>>,
  command: Extract<HeadlessCommand, { command: "start" }>,
): Promise<HeadlessResult> {
  const now = new Date().toISOString();
  return updateJournal(context.journal, async (journal) => {
    let identity = command.identityId ? findIdentity(journal, command.identityId, tenant.id) : undefined;
    if (command.identityId && (!identity || identity.origin !== "headless" || identity.localProjectId !== readProjectId(context.configText) || identity.tenantSlug !== tenant.slug)) {
      throw new Error("IDENTITY_NOT_FOUND");
    }

    if (!identity) {
      identity = {
        id: createId("hid"),
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        localProjectId: readProjectId(context.configText),
        origin: "headless",
        customerId: "",
        createdAt: now,
      };
      const customer = await findOrCreateCustomer({
        env: context.env,
        schemaName: tenant.schemaName,
        phone: `headless-${identity.id}`,
      });
      identity.customerId = customer.id;
      journal.identities.push(identity);
    }

    const conversation = await loadOrCreateActiveConversation({
      env: context.env,
      schemaName: tenant.schemaName,
      customerId: identity.customerId,
    });
    const session: JournalSession = {
      id: createId("hss"),
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      localProjectId: readProjectId(context.configText),
      identityId: identity.id,
      customerId: identity.customerId,
      conversationId: conversation.id,
      state: "active",
      createdAt: now,
      updatedAt: now,
      closedAt: null,
      lastTurnId: null,
      activeTurnId: null,
      activeTurnClaimedAt: null,
      turns: [],
    };
    journal.sessions.push(session);

    return createResult({
      command: "start",
      status: "started",
      tenant: { id: tenant.id, slug: tenant.slug },
      session: toSessionResult(session),
    });
  });
}

async function processTurn(
  context: HeadlessApplicationContext,
  tenant: Awaited<ReturnType<typeof resolveHeadlessTenant>>,
  command: Extract<HeadlessCommand, { command: "turn" }>,
): Promise<HeadlessResult> {
  if (context.journal.withSessionLock) {
    return context.journal.withSessionLock(command.sessionId, () => processTurnLocked(context, tenant, command));
  }
  return processTurnLocked(context, tenant, command);
}

async function processTurnLocked(
  context: HeadlessApplicationContext,
  tenant: Awaited<ReturnType<typeof resolveHeadlessTenant>>,
  command: Extract<HeadlessCommand, { command: "turn" }>,
): Promise<HeadlessResult> {
  const journal = await context.journal.read();
  const session = findSession(journal, command.sessionId, tenant.id);
  if (!session) throw new Error("SESSION_NOT_FOUND");
  assertSessionBinding(journal, session, tenant, context.configText);
  if (session.state === "closed") throw new Error("SESSION_CLOSED");

  const digest = await digestText(command.text);
  const previous = session.turns.find((turn) => turn.id === command.turnId);
  if (previous) {
    if (previous.digest !== digest) throw new Error("IDEMPOTENCY_CONFLICT");
    if (previous.state === "pending") {
      return createResult({
        command: "turn",
        status: "pending",
        tenant: { id: tenant.id, slug: tenant.slug },
        session: toSessionResult(session),
        turn: toTurnResult(previous),
        responses: previous.responses,
        routing: previous.routing,
        warnings: ["AUTOMATION_PAUSED"],
      });
    }
    if (previous.state === "indeterminate") {
      return createResult({
        command: "turn",
        status: "indeterminate",
        tenant: { id: tenant.id, slug: tenant.slug },
        session: toSessionResult(session),
        turn: toTurnResult(previous),
        responses: previous.responses,
        routing: previous.routing,
        error: safeError({ code: "TURN_INDETERMINATE", category: "conflict", safeMessage: "El turno requiere inspección y reconciliación explícitas." }),
      });
    }
    if (previous.state === "processing" || previous.state === "claimed") {
      const durable = await waitForDurableTurn(context.journal, command.sessionId, tenant.id, command.turnId);
      if (durable.turn?.state === "processing" || durable.turn?.state === "claimed") {
        return createResult({
          command: "turn",
          status: "indeterminate",
          tenant: { id: tenant.id, slug: tenant.slug },
          session: durable.session ? toSessionResult(durable.session) : toSessionResult(session),
          turn: toTurnResult(durable.turn ?? previous),
          responses: durable.turn?.responses ?? previous.responses,
          routing: durable.turn?.routing ?? previous.routing,
          error: safeError({ code: "TURN_INDETERMINATE", category: "conflict", safeMessage: "El turno sigue en procesamiento y requiere inspección." }),
        });
      }
      return createResult({
        command: "turn",
        status: "repeated",
        tenant: { id: tenant.id, slug: tenant.slug },
        session: durable.session ? toSessionResult(durable.session) : toSessionResult(session),
        turn: toTurnResult(durable.turn ?? previous),
        responses: durable.turn?.responses ?? previous.responses,
        routing: durable.turn?.routing ?? previous.routing,
      });
    }
    return createResult({
      command: "turn",
      status: "repeated",
      tenant: { id: tenant.id, slug: tenant.slug },
      session: toSessionResult(session),
      turn: toTurnResult(previous),
      responses: previous.responses,
      routing: previous.routing,
    });
  }

  const conversationRow = await selectConversationById({
    env: context.env,
    schemaName: tenant.schemaName,
    conversationId: session.conversationId,
  });
  if (!conversationRow) throw new Error("SESSION_NOT_FOUND");
  const loadedConversation = mapConversationRow(conversationRow);
  let conversation = loadedConversation;
  if (conversationNeedsExpiration(loadedConversation) || ["completed", "expired"].includes(loadedConversation.state)) {
    conversation = await loadOrCreateActiveConversation({
      env: context.env,
      schemaName: tenant.schemaName,
      customerId: loadedConversation.customerId,
    });
    await updateJournal(context.journal, (next) => {
      const current = findSession(next, command.sessionId, tenant.id);
      if (current) current.conversationId = conversation.id;
    });
  } else {
    conversation = await touchConversationForInbound({
      env: context.env,
      schemaName: tenant.schemaName,
      conversation,
    });
  }
  const before = await loadHeadlessSnapshot({ env: context.env, schemaName: tenant.schemaName, conversation });
  const turn: JournalSession["turns"][number] = {
    id: command.turnId,
    digest,
    state: "processing" as const,
    retriable: false,
    manifestPresent: false,
    manifestValid: false,
    responses: [],
    createdAt: new Date().toISOString(),
  };

  const claim = await updateJournal(context.journal, (next) => {
    const current = findSession(next, command.sessionId, tenant.id);
    if (!current) throw new Error("SESSION_NOT_FOUND");
    if (current.state === "closed") throw new Error("SESSION_CLOSED");
    const existing = current.turns.find((candidate) => candidate.id === command.turnId);
    if (existing) {
      if (existing.digest !== digest) throw new Error("IDEMPOTENCY_CONFLICT");
      return { existing: true, turn: existing, session: current };
    }
    const activeTurn = current.activeTurnId ? current.turns.find((candidate) => candidate.id === current.activeTurnId) : undefined;
    if (activeTurn && activeTurn.id !== command.turnId && ["claimed", "processing"].includes(activeTurn.state)) {
      if (!recoverStaleActiveTurn(current)) throw new Error("SESSION_BUSY");
    }
    const claimedAt = new Date().toISOString();
    current.activeTurnId = command.turnId;
    current.activeTurnClaimedAt = claimedAt;
    current.lastTurnId = command.turnId;
    current.updatedAt = claimedAt;
    turn.claimedAt = claimedAt;
    turn.updatedAt = claimedAt;
    current.turns.push(turn);
    return { existing: false, turn, session: current };
  });

  if (claim.existing) {
    const durable = await waitForDurableTurn(context.journal, command.sessionId, tenant.id, command.turnId);
    return createResult({
      command: "turn",
      status: "repeated",
      tenant: { id: tenant.id, slug: tenant.slug },
      session: durable.session ? toSessionResult(durable.session) : undefined,
      turn: toTurnResult(durable.turn ?? claim.turn),
      responses: durable.turn?.responses ?? [],
      routing: durable.turn?.routing,
    });
  }

  const message: NormalizedInboundMessage = {
    provider: "headless",
    providerMessageId: `headless:${session.id}:${command.turnId}`,
    phoneNumberId: "headless",
    from: `headless-${session.identityId}`,
    timestamp: new Date().toISOString(),
    type: "text",
    text: command.text,
    raw: { source: "headless", type: "text" },
  };

    const responses = [] as import("../chat-routing/ports").CapturedResponse[];
    const headlessEffectIds: string[] = [];
    const headlessEffects: HeadlessEffectRecord[] = [];
  try {
    const logged = await logInboundMessage({
      env: context.env,
      schemaName: tenant.schemaName,
      conversationId: conversation.id,
      message,
    });
    await updateJournal(context.journal, (next) => {
      const current = findSession(next, command.sessionId, tenant.id);
      const currentTurn = current?.turns.find((candidate) => candidate.id === command.turnId);
      if (currentTurn) currentTurn.inboundMessageId = logged.id;
    });
    if (!tenant.automationEnabled || !conversation.automationEnabled || conversation.state === "manual") {
      const after = await loadHeadlessSnapshot({ env: context.env, schemaName: tenant.schemaName, conversation });
      const routing = projectRouting({ responseSource: "deterministic", responseReason: "automation_paused", llm: { attempted: false, used: false, outcome: "skipped_or_failed", operationTypes: [] } });
      await updateJournal(context.journal, (next) => {
        const currentTurn = findSession(next, command.sessionId, tenant.id)?.turns.find((candidate) => candidate.id === command.turnId);
        if (currentTurn) {
          currentTurn.state = "pending";
          currentTurn.routing = routing;
          currentTurn.responses = [];
          currentTurn.updatedAt = new Date().toISOString();
          const currentSession = findSession(next, command.sessionId, tenant.id);
          if (currentSession) {
            currentSession.activeTurnId = null;
            currentSession.activeTurnClaimedAt = null;
            currentSession.updatedAt = new Date().toISOString();
          }
        }
      });
      return createResult({
        command: "turn",
        status: "pending",
        tenant: { id: tenant.id, slug: tenant.slug },
        session: toSessionResult(session),
        turn: { id: command.turnId, state: "pending", retriable: false },
        before,
        after,
        routing,
        effects: [{ type: "inbound_message", status: "created", id: logged.id }],
        warnings: ["AUTOMATION_PAUSED"],
      });
    }
    let manifestCheckpointed = false;
    let checkpointedManifest: ValidatedExecutionManifest | null = null;
    const checkpoint = async (manifest: ValidatedExecutionManifest): Promise<void> => {
      if (manifestCheckpointed) return;
      await context.beforeCheckpoint?.(manifest);
      await checkpointNormalizedInbound({
        env: context.env,
        schemaName: tenant.schemaName,
        messageId: logged.id,
        manifest,
      });
      await context.afterCheckpoint?.(manifest);
      manifestCheckpointed = true;
      checkpointedManifest = manifest;
      await updateJournal(context.journal, (next) => {
        const current = findSession(next, command.sessionId, tenant.id);
        const currentTurn = current?.turns.find((candidate) => candidate.id === command.turnId);
        if (currentTurn) {
          currentTurn.manifestPresent = true;
          currentTurn.manifestValid = true;
        }
      });
    };
    const delivery = createHeadlessCapture({
      captureContext: "turn",
      originatingTurnId: command.turnId,
      observer: { onResponse: (response) => responses.push(response) },
    });
    const processed = await processNormalizedChatTurn({
      env: context.env,
      tenant,
      conversation,
      message,
      traceId: `headless-${session.id}-${command.turnId}`,
      loggedMessageId: logged.id,
      source: "headless",
      delivery,
      beforeFirstEffect: checkpoint,
      headlessEffectIds,
      headlessEffects,
      // Production-like headless runs always use the tenant's configured provider.
      // Deterministic provider responses belong in injected test harnesses, not in
      // the CLI protocol exposed to an operator.
      semanticGeneration: context.semanticGeneration,
      afterEffect: context.afterEffect,
    });
    if (!manifestCheckpointed) {
      await checkpoint({
        version: 1,
        digest,
        operationTypes: [],
        canonicalIds: [],
        idempotencyKeys: [message.providerMessageId],
        preconditions: [`conversation.state:${conversation.state}`],
        postconditionFingerprints: [
          `conversation.state:${await digestText(`conversation.state:${conversation.state}`)}`,
          `outbound_messages:${await digestText(message.providerMessageId)}`,
        ],
      });
    }
    const afterRow = await selectConversationById({ env: context.env, schemaName: tenant.schemaName, conversationId: conversation.id });
    const afterConversation = afterRow ? mapConversationRow(afterRow) : conversation;
    const after = await loadHeadlessSnapshot({ env: context.env, schemaName: tenant.schemaName, conversation: afterConversation });
    const routing = projectRouting(processed.routingTrace);
    const finalManifest = checkpointedManifest as ValidatedExecutionManifest | null;
    await finalizeNormalizedInbound({
      env: context.env,
      schemaName: tenant.schemaName,
      messageId: logged.id,
      postconditions: {
        manifestDigest: finalManifest?.digest ?? null,
        postconditionFingerprints: finalManifest?.postconditionFingerprints ?? [],
        effectIds: [logged.id, ...headlessEffectIds],
        conversationState: after.conversation?.state ?? null,
        responseCount: responses.length,
      },
    });
    await updateJournal(context.journal, (next) => {
      const current = findSession(next, command.sessionId, tenant.id);
      const currentTurn = current?.turns.find((candidate) => candidate.id === command.turnId);
      if (!currentTurn) throw new Error("SESSION_NOT_FOUND");
      currentTurn.state = "applied";
      currentTurn.responses = responses;
      currentTurn.routing = routing;
      currentTurn.inboundMessageId = logged.id;
      currentTurn.updatedAt = new Date().toISOString();
      if (current) {
        current.activeTurnId = null;
        current.activeTurnClaimedAt = null;
        current.updatedAt = new Date().toISOString();
      }
    });
    return createResult({
      command: "turn",
      status: "applied",
      tenant: { id: tenant.id, slug: tenant.slug },
      session: toSessionResult(session),
      turn: { id: command.turnId, state: "applied", retriable: false },
      responses,
      before,
      after,
      routing,
      effects: [{ type: "inbound_message", status: "created", id: logged.id }, ...(headlessEffects.length > 0 ? headlessEffects : headlessEffectIds.map((id) => ({ type: "outbound_message" as const, status: "captured" as const, id })))],
    });
  } catch (error: unknown) {
    await updateJournal(context.journal, (next) => {
      const current = findSession(next, command.sessionId, tenant.id);
      const currentTurn = current?.turns.find((candidate) => candidate.id === command.turnId);
      if (currentTurn) {
        currentTurn.state = "indeterminate";
        currentTurn.retriable = false;
        currentTurn.responses = responses;
        currentTurn.errorCode = "TURN_INDETERMINATE";
        currentTurn.updatedAt = new Date().toISOString();
        const currentSession = findSession(next, command.sessionId, tenant.id);
        if (currentSession) {
          currentSession.activeTurnId = null;
          currentSession.activeTurnClaimedAt = null;
          currentSession.updatedAt = new Date().toISOString();
        }
      }
    });
    throw new Error("TURN_INDETERMINATE");
  }
}

async function inspectSession(
  context: HeadlessApplicationContext,
  tenant: Awaited<ReturnType<typeof resolveHeadlessTenant>>,
  command: Extract<HeadlessCommand, { command: "inspect" }>,
): Promise<HeadlessResult> {
  const journal = await context.journal.read();
  const session = findSession(journal, command.sessionId, tenant.id);
  if (!session) throw new Error("SESSION_NOT_FOUND");
  assertSessionBinding(journal, session, tenant, context.configText);
  const row = await selectConversationById({ env: context.env, schemaName: tenant.schemaName, conversationId: session.conversationId });
  const responses = await loadRecentConversationMessages({ env: context.env, schemaName: tenant.schemaName, conversationId: session.conversationId, limit: 50, direction: "outbound" });
  const manualResumeResponses = await loadManualResumeCapturedResponses({ env: context.env, schemaName: tenant.schemaName, conversationId: session.conversationId });
  const latestTurn = session.turns.at(-1);
  return createResult({
    command: "inspect",
    status: "inspected",
    tenant: { id: tenant.id, slug: tenant.slug },
    session: toSessionResult(session),
    turn: latestTurn ? toTurnResult(latestTurn) : null,
    responses: [...(latestTurn?.responses ?? responses.map((message) => projectCapturedResponse({
      type: message.messageType === "image" ? "image" : "text",
      ...(message.text ? { text: message.text } : {}),
      captureContext: "manual_resume",
    }))), ...manualResumeResponses],
    before: row ? await loadHeadlessSnapshot({ env: context.env, schemaName: tenant.schemaName, conversation: mapConversationRow(row) }) : null,
    after: row ? await loadHeadlessSnapshot({ env: context.env, schemaName: tenant.schemaName, conversation: mapConversationRow(row) }) : null,
    routing: latestTurn?.routing,
  });
}

async function reconcileTurn(
  context: HeadlessApplicationContext,
  tenant: Awaited<ReturnType<typeof resolveHeadlessTenant>>,
  command: Extract<HeadlessCommand, { command: "reconcile" }>,
): Promise<HeadlessResult> {
  if (context.journal.withSessionLock) {
    return context.journal.withSessionLock(command.sessionId, () => reconcileTurnLocked(context, tenant, command));
  }
  return reconcileTurnLocked(context, tenant, command);
}

async function reconcileTurnLocked(
  context: HeadlessApplicationContext,
  tenant: Awaited<ReturnType<typeof resolveHeadlessTenant>>,
  command: Extract<HeadlessCommand, { command: "reconcile" }>,
): Promise<HeadlessResult> {
  const journal = await context.journal.read();
  const session = findSession(journal, command.sessionId, tenant.id);
  const turn = session?.turns.find((candidate) => candidate.id === command.turnId);
  if (!session || !turn) throw new Error("SESSION_NOT_FOUND");
  assertSessionBinding(journal, session, tenant, context.configText);
  if (turn.state !== "indeterminate") throw new Error("RECONCILIATION_MISMATCH");
  if (!turn.inboundMessageId) throw new Error("RECONCILIATION_MISMATCH");
  const [message] = await createSupabaseRestClient(context.env).select<{
    status: string;
    payload: unknown;
  }>({
    schema: tenant.schemaName,
    table: "messages",
    query: {
      select: "status,payload",
      id: `eq.${turn.inboundMessageId}`,
      direction: "eq.inbound",
      provider: "eq.headless",
      limit: 1,
    },
  });
  if (!message) throw new Error("RECONCILIATION_MISMATCH");
  const decision = reconcileNormalizedChatTurn({
    observation: command.observedOutcome,
    evidence: deriveReconciliationEvidence({ messageStatus: message.status, payload: message.payload }),
  });
  if (decision.outcome === "indeterminate") {
    return createResult({ command: "reconcile", status: "indeterminate", tenant: { id: tenant.id, slug: tenant.slug }, session: toSessionResult(session), turn: toTurnResult(turn), error: safeError({ code: "TURN_INDETERMINATE", category: "conflict", safeMessage: "El turno requiere inspección adicional." }) });
  }
  const authoritative = await createSupabaseRestClient(context.env).rpc<{
    status: "applied" | "failed" | "indeterminate";
    reason_code?: string;
  }>({
    schema: "control",
    functionName: "reconcile_normalized_inbound",
    args: {
      p_schema_name: tenant.schemaName,
      p_message_id: turn.inboundMessageId,
      p_observed_outcome: command.observedOutcome,
    },
  });
  if (authoritative.status === "indeterminate") {
    return createResult({
      command: "reconcile",
      status: "indeterminate",
      tenant: { id: tenant.id, slug: tenant.slug },
      session: toSessionResult(session),
      turn: toTurnResult(turn),
      error: safeError({ code: "TURN_INDETERMINATE", category: "conflict", safeMessage: "La base aún no demuestra una resolución completa." }),
      warnings: [authoritative.reason_code ?? "AUTHORITATIVE_EVIDENCE_INSUFFICIENT"],
    });
  }
  const authoritativeOutcome = authoritative.status === "applied" ? "applied" : "failed";
  await updateJournal(context.journal, (next) => {
    const session = findSession(next, command.sessionId, tenant.id);
    const current = session?.turns.find((candidate) => candidate.id === command.turnId);
    if (current) {
      current.state = authoritativeOutcome;
      current.updatedAt = new Date().toISOString();
    }
    if (session) {
      session.activeTurnId = null;
      session.activeTurnClaimedAt = null;
      session.updatedAt = new Date().toISOString();
    }
  });
  return createResult({ command: "reconcile", status: "reconciled", tenant: { id: tenant.id, slug: tenant.slug }, session: toSessionResult(session), turn: { id: turn.id, state: authoritativeOutcome, retriable: false }, warnings: [authoritative.reason_code ?? decision.reasonCode] });
}

async function closeSession(
  context: HeadlessApplicationContext,
  tenant: Awaited<ReturnType<typeof resolveHeadlessTenant>>,
  command: Extract<HeadlessCommand, { command: "close" }>,
): Promise<HeadlessResult> {
  const close = async () => {
    const session = await updateJournal(context.journal, (journal) => {
    const current = findSession(journal, command.sessionId, tenant.id);
    if (!current) throw new Error("SESSION_NOT_FOUND");
    assertHeadlessSessionBinding({ journal, session: current, tenant, localProjectId: readProjectId(context.configText) });
    if (current.state === "active") {
      if (current.activeTurnId) {
        if (!recoverStaleActiveTurn(current)) throw new Error("SESSION_BUSY");
      }
      current.state = "closed";
      current.closedAt = new Date().toISOString();
      current.updatedAt = current.closedAt;
    }
    return current;
    });
    return createResult({ command: "close", status: "closed", tenant: { id: tenant.id, slug: tenant.slug }, session: toSessionResult(session) });
  };
  if (context.journal.withSessionLock) return context.journal.withSessionLock(command.sessionId, close);
  return close();
}

function toSessionResult(session: JournalSession): NonNullable<HeadlessResult["session"]> {
  return { id: session.id, identityId: session.identityId, state: session.state, createdAt: session.createdAt, closedAt: session.closedAt };
}

function toTurnResult(turn: JournalSession["turns"][number]): NonNullable<HeadlessResult["turn"]> {
  return { id: turn.id, state: turn.state, retriable: turn.retriable };
}

function projectRouting(trace: { responseSource?: string; responseReason?: string; llm?: { attempted: boolean; used: boolean; provider?: string; model?: string; outcome: string; operationTypes?: string[] } } | undefined): NonNullable<HeadlessResult["routing"]> {
  return {
    branch: trace?.responseSource ?? "unknown",
    reasonCode: (trace?.responseReason ?? "UNKNOWN").toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 96),
    ai: {
      attempted: trace?.llm?.attempted ?? false,
      used: trace?.llm?.used ?? false,
      provider: trace?.llm?.provider ?? null,
      model: trace?.llm?.model ?? null,
      outcome: trace?.llm?.outcome ?? null,
      operationTypes: trace?.llm?.operationTypes ?? [],
    },
  };
}

async function digestText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createId(prefix: "hid" | "hss"): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function readProjectId(configText: string): string {
  return configText.match(/^\s*project_id\s*=\s*["']([^"']+)["']/m)?.[1] ?? "unknown-local-project";
}

function assertSessionBinding(
  journal: import("./session-journal").JournalFile,
  session: JournalSession,
  tenant: Awaited<ReturnType<typeof resolveHeadlessTenant>>,
  configText: string,
): void {
  assertHeadlessSessionBinding({ journal, session, tenant, localProjectId: readProjectId(configText) });
}

function inferCommand(input: unknown): HeadlessResult["command"] {
  return input && typeof input === "object" && typeof (input as { command?: unknown }).command === "string"
    ? ((input as { command: string }).command as HeadlessResult["command"])
    : "unknown";
}

function toSafeError(error: unknown): HeadlessResult["error"] {
  const code = allowlistedErrorCode(error instanceof Error ? error.message : "INTERNAL_SAFE_ERROR");
  const category: "input" | "security" | "tenant" | "session" | "ai" | "dependency" | "conflict" | "internal" = code === "TENANT_NOT_FOUND" ? "tenant" : code === "AI_PROVIDER_UNAVAILABLE" ? "ai" : code === "DATABASE_UNAVAILABLE" ? "dependency" : code === "SESSION_BUSY" || code.includes("CONFLICT") || code.includes("MISMATCH") ? "conflict" : code.includes("SESSION") || code.includes("IDENTITY") ? "session" : code === "HEADLESS_DISABLED" || code === "UNAUTHORIZED_TARGET_ENV" ? "security" : code.includes("TEXT") || code.includes("COMMAND") || code.includes("VERSION") ? "input" : "internal";
  return safeError({ code, category, retriable: code === "DATABASE_UNAVAILABLE", safeMessage: safeMessageFor(code) });
}

function allowlistedErrorCode(rawCode: string): string {
  const exact = new Set([
    "HEADLESS_DISABLED", "UNAUTHORIZED_TARGET_ENV", "TENANT_NOT_FOUND", "SESSION_NOT_FOUND", "SESSION_CLOSED",
    "SESSION_BUSY", "IDENTITY_NOT_FOUND", "IDEMPOTENCY_CONFLICT", "TEXT_TOO_LONG", "INVALID_COMMAND",
    "UNSUPPORTED_VERSION", "TURN_INDETERMINATE", "RECONCILIATION_MISMATCH", "LOCK_UNAVAILABLE",
  ]);
  if (exact.has(rawCode)) return rawCode;
  if (/^supabase_(?:select|insert|update|upsert|rpc|delete|storage)_failed:/i.test(rawCode)
    || rawCode === "DATABASE_UNAVAILABLE"
    || /(?:fetch failed|econnrefused|enotfound|etimedout|network_not_allowed)/i.test(rawCode)) return "DATABASE_UNAVAILABLE";
  if (/^LOCK_/.test(rawCode)) return "LOCK_UNAVAILABLE";
  if (/provider|gemini|openrouter|quota|resource_exhausted/i.test(rawCode)) return "AI_PROVIDER_UNAVAILABLE";
  return "HEADLESS_OPERATION_FAILED";
}

function safeMessageFor(code: string): string {
  const messages: Record<string, string> = {
    HEADLESS_DISABLED: "El modo headless no está habilitado en este entorno.",
    UNAUTHORIZED_TARGET_ENV: "El destino local no supera los gates requeridos.",
    TENANT_NOT_FOUND: "El tenant no está disponible.",
    SESSION_NOT_FOUND: "La sesión no está disponible.",
    SESSION_CLOSED: "La sesión está cerrada.",
    SESSION_BUSY: "La sesión está procesando otro turno.",
    IDEMPOTENCY_CONFLICT: "El turno ya existe con otro contenido.",
    TEXT_TOO_LONG: "El texto no cumple el límite permitido.",
    TURN_INDETERMINATE: "El turno requiere reconciliación explícita.",
    DATABASE_UNAVAILABLE: "La dependencia local no está disponible.",
    AI_PROVIDER_UNAVAILABLE: "El proveedor de IA no está disponible.",
    HEADLESS_OPERATION_FAILED: "La operación no pudo completarse.",
  };
  return messages[code] ?? "La operación no pudo completarse.";
}

async function waitForDurableTurn(
  store: import("./session-journal").JournalStore,
  sessionId: string,
  tenantId: string,
  turnId: string,
): Promise<{ session: JournalSession | undefined; turn: JournalSession["turns"][number] | undefined }> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const journal = await store.read();
    const session = findSession(journal, sessionId, tenantId);
    const turn = session?.turns.find((candidate) => candidate.id === turnId);
    if (!turn || turn.state !== "processing") return { session, turn };
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const journal = await store.read();
  const session = findSession(journal, sessionId, tenantId);
  return { session, turn: session?.turns.find((candidate) => candidate.id === turnId) };
}
