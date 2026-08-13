import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryJournalStore, updateJournal } from "../src/features/headless-chat/session-journal.ts";

test("journal persists sessions across application instances", async () => {
  const journal = createMemoryJournalStore();
  await updateJournal(journal, (value) => {
    value.identities.push({ id: "hid_123456", tenantId: "tenant", customerId: "customer", createdAt: new Date().toISOString() });
    value.sessions.push({ id: "hss_123456", tenantId: "tenant", tenantSlug: "demo", identityId: "hid_123456", customerId: "customer", conversationId: "conversation", state: "active", createdAt: new Date().toISOString(), closedAt: null, turns: [] });
  });
  const loaded = await journal.read();
  assert.equal(loaded.sessions[0]?.id, "hss_123456");
});
