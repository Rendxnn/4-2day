import assert from "node:assert/strict";
import test from "node:test";
import { reconcileNormalizedChatTurn } from "../src/features/chat-routing/reconcile-normalized-chat-turn.ts";
import { createMemoryJournalStore, emptyJournal, recoverStaleActiveTurn, updateJournal, validateJournal } from "../src/features/headless-chat/session-journal.ts";

test("corrupt or absent manifest remains indeterminate", () => {
  const result = reconcileNormalizedChatTurn({ observation: "no_effects", evidence: { manifestPresent: false, manifestValid: false, allPostconditionsSatisfied: false, noPostconditionsSatisfied: true, partialEffects: false } });
  assert.equal(result.outcome, "indeterminate");
});

test("memory journal serializes concurrent updates and validates its version", async () => {
  const journal = createMemoryJournalStore();
  await Promise.all(Array.from({ length: 12 }, (_, index) => updateJournal(journal, (value) => {
    value.identities.push({ id: `hid_${String(index).padStart(6, "0")}`, tenantId: "tenant", customerId: `customer-${index}`, createdAt: "2026-08-12T00:00:00.000Z" });
  })));
  const result = await journal.read();
  assert.equal(result.identities.length, 12);
  assert.throws(() => validateJournal({ ...emptyJournal(), version: 2 }), /JOURNAL_INVALID_VERSION/);
  assert.throws(() => validateJournal({ ...emptyJournal(), sessions: [{ id: "hss_bad", tenantId: "tenant", identityId: "hid_bad", customerId: "c", conversationId: "v", state: "closed", closedAt: null, createdAt: "2026-08-12T00:00:00.000Z", turns: [] }] }), /JOURNAL_INVALID_SESSION_STATE/);
  assert.throws(() => validateJournal({ ...emptyJournal(), identities: [{ id: "hid_a", tenantId: "tenant-a", customerId: "customer-a", createdAt: "2026-08-12T00:00:00.000Z" }], sessions: [{ id: "hss_a", tenantId: "tenant-b", tenantSlug: "b", identityId: "hid_a", customerId: "customer-a", conversationId: "conversation", state: "active", createdAt: "2026-08-12T00:00:00.000Z", closedAt: null, turns: [] }] }), /JOURNAL_IDENTITY_TENANT_MISMATCH/);
  assert.throws(() => validateJournal({ ...emptyJournal(), identities: [{ id: "hid_a", tenantId: "tenant", customerId: "customer", createdAt: "2026-08-12T00:00:00.000Z" }], sessions: [{ id: "hss_a", tenantId: "tenant", tenantSlug: "demo", identityId: "hid_a", customerId: "customer", conversationId: "conversation", state: "active", createdAt: "2026-08-12T00:00:00.000Z", closedAt: null, turns: [{ id: "turn-a", digest: "digest", state: "applied", retriable: false, manifestPresent: false, manifestValid: false, responses: [], createdAt: "2026-08-12T00:00:00.000Z" }, { id: "turn-a", digest: "digest", state: "applied", retriable: false, manifestPresent: false, manifestValid: false, responses: [], createdAt: "2026-08-12T00:00:00.000Z" }] }] }), /JOURNAL_DUPLICATE_TURN/);
});

test("session lock serializes a whole turn while different sessions remain independent", async () => {
  const journal = createMemoryJournalStore();
  const events = [];
  const run = (sessionId, label, delay) => journal.withSessionLock(sessionId, async () => {
    events.push(`${label}:start`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    events.push(`${label}:end`);
  });

  await Promise.all([run("hss_same", "a", 20), run("hss_same", "b", 0), run("hss_other", "c", 0)]);
  assert.ok(events.indexOf("a:end") < events.indexOf("b:start"));
  assert.ok(events.includes("c:start"));
});

test("journal rejects more than one active turn and an orphan active pointer", () => {
  const base = {
    version: 1,
    identities: [{ id: "hid_a", tenantId: "tenant", customerId: "customer", origin: "headless", createdAt: "2026-08-12T00:00:00.000Z" }],
    sessions: [{ id: "hss_a", tenantId: "tenant", tenantSlug: "demo", identityId: "hid_a", customerId: "customer", conversationId: "conversation", state: "active", activeTurnId: "turn-a", createdAt: "2026-08-12T00:00:00.000Z", closedAt: null, turns: [
      { id: "turn-a", digest: "a", state: "processing", retriable: false, manifestPresent: false, manifestValid: false, responses: [], createdAt: "2026-08-12T00:00:00.000Z" },
      { id: "turn-b", digest: "b", state: "processing", retriable: false, manifestPresent: false, manifestValid: false, responses: [], createdAt: "2026-08-12T00:00:00.000Z" },
    ] }],
  };
  assert.throws(() => validateJournal(base), /JOURNAL_MULTIPLE_ACTIVE_TURNS/);
  assert.throws(() => validateJournal({ ...base, sessions: [{ ...base.sessions[0], turns: [{ ...base.sessions[0].turns[0], state: "applied" }] }] }), /JOURNAL_INVALID_ACTIVE_TURN/);
});

test("stale active turn becomes indeterminate and releases the session without replay", () => {
  const session = {
    id: "hss_stale",
    tenantId: "tenant",
    tenantSlug: "demo",
    localProjectId: "42day",
    identityId: "hid_a",
    customerId: "customer",
    conversationId: "conversation",
    state: "active",
    createdAt: "2026-08-12T00:00:00.000Z",
    closedAt: null,
    activeTurnId: "turn-stale",
    activeTurnClaimedAt: "2026-08-12T00:00:00.000Z",
    turns: [{ id: "turn-stale", digest: "digest", state: "processing", retriable: false, manifestPresent: true, manifestValid: true, responses: [], createdAt: "2026-08-12T00:00:00.000Z" }],
  };

  assert.equal(recoverStaleActiveTurn(session, Date.parse("2026-08-12T00:03:00.000Z"), 120_000), true);
  assert.equal(session.turns[0].state, "indeterminate");
  assert.equal(session.activeTurnId, null);
  assert.equal(recoverStaleActiveTurn(session, Date.parse("2026-08-12T00:04:00.000Z"), 120_000), false);
});
