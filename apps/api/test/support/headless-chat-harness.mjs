import assert from "node:assert/strict";
import { createMemoryJournalStore } from "../../src/features/headless-chat/session-journal.ts";

export function createDeterministicClock(start = "2026-08-12T12:00:00.000Z") {
  let current = new Date(start);
  return {
    now: () => new Date(current),
    advance: (milliseconds) => { current = new Date(current.getTime() + milliseconds); },
  };
}

export function createDeterministicIdFactory() {
  let counter = 0;
  return (prefix) => `${prefix}_${String(++counter).padStart(6, "0")}`;
}

export function createNoNetworkFetchSpy() {
  const calls = [];
  return {
    calls,
    fetch: async (...args) => {
      calls.push(args);
      throw new Error("network_not_allowed_in_test");
    },
  };
}

export function createJournal() {
  return createMemoryJournalStore();
}

/**
 * Validate the only target that local reset/cleanup helpers may touch.
 * This helper deliberately validates configuration but never executes a reset.
 */
export function assertLocalSupabaseResetTarget({ configText, env }) {
  const projectId = configText.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
  const apiPort = configText.match(/^port\s*=\s*(\d+)\s*$/m)?.[1];
  const dbPort = configText.match(/\[db\][\s\S]*?^port\s*=\s*(\d+)\s*$/m)?.[1];
  const apiUrl = new URL(env.SUPABASE_URL ?? "");

  if (projectId !== "42day" || env.PARAHOY_HEADLESS_LOCAL_PROJECT_ID !== "42day") {
    throw new Error("LOCAL_RESET_PROJECT_MISMATCH");
  }
  if (apiUrl.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(apiUrl.hostname)) {
    throw new Error("LOCAL_RESET_ENDPOINT_REQUIRED");
  }
  if (apiUrl.port !== apiPort || !dbPort) {
    throw new Error("LOCAL_RESET_PORT_MISMATCH");
  }

  return {
    projectId,
    apiUrl: apiUrl.toString().replace(/\/$/, ""),
    dbPort,
    allowedTenants: ["headless-demo", "headless-isolation-b"],
    resetCommand: "supabase db reset --local",
  };
}

export function assertSafeProjection(value) {
  assert.equal(typeof value.redacted, "boolean");
  assert.ok(Array.isArray(value.redactionCodes));
  assert.equal(value.delivery, "captured");
}

export function canonicalizeParity(value) {
  const aliases = new Map();
  const timestamps = new Map();

  function visit(current, key = "") {
    if (Array.isArray(current)) return current.map((entry) => visit(entry));
    if (!current || typeof current !== "object") {
      if (typeof current === "string" && /At$/.test(key) && !Number.isNaN(Date.parse(current))) {
        if (!timestamps.has(current)) timestamps.set(current, `time_${timestamps.size}`);
        return timestamps.get(current);
      }
      if (typeof current === "string" && /(?:^id$|Id$|_id$)/.test(key) && current.length > 0) {
        if (!aliases.has(current)) aliases.set(current, `id_${aliases.size}`);
        return aliases.get(current);
      }
      return current;
    }

    const result = {};
    for (const [childKey, childValue] of Object.entries(current)) {
      if (["source", "provider", "providerMessageId", "delivery", "signature", "webhookEventId"].includes(childKey)) continue;
      result[childKey] = visit(childValue, childKey);
    }
    return result;
  }

  return visit(value);
}
