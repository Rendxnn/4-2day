import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHeadlessCommand } from "../src/features/headless-chat/contracts.ts";
import { createResult } from "../src/features/headless-chat/result.ts";

test("headless command contract accepts the v1 turn and preserves Unicode length", () => {
  const command = parseHeadlessCommand({ version: 1, command: "turn", tenant: "demo", sessionId: "hss_123456", turnId: "turn-1", text: "á" });
  assert.equal(command.command, "turn");
});

test("headless command contract rejects empty, oversized and media inputs", () => {
  assert.throws(() => parseHeadlessCommand({ version: 1, command: "turn", tenant: "demo", sessionId: "hss_123456", turnId: "turn-1", text: "" }), /TEXT_TOO_LONG/);
  assert.throws(() => parseHeadlessCommand({ version: 1, command: "turn", tenant: "demo", sessionId: "hss_123456", turnId: "turn-1", text: "x".repeat(4097) }), /TEXT_TOO_LONG/);
  assert.throws(() => parseHeadlessCommand({ version: 1, command: "turn", tenant: "demo", sessionId: "hss_123456", turnId: "turn-1", text: "x", media: "image" }), /INVALID_COMMAND/);
});

test("result envelope has mutually exclusive durable status fields", () => {
  const result = createResult({ command: "start", status: "started" });
  assert.equal(result.version, 1);
  assert.equal(result.error, null);
  assert.deepEqual(result.responses, []);
});

test("paused turns have an explicit pending result without a fake response", () => {
  const result = createResult({ command: "turn", status: "pending", warnings: ["AUTOMATION_PAUSED"] });
  assert.equal(result.status, "pending");
  assert.deepEqual(result.responses, []);
  assert.deepEqual(result.warnings, ["AUTOMATION_PAUSED"]);
});

test("result envelope statuses and redaction fields stay aligned with the v1 schema", async () => {
  const schema = JSON.parse(await readFile(new URL("../../../specs/001-headless-chat/contracts/headless-result.schema.json", import.meta.url), "utf8"));
  const statuses = schema.properties.status.enum;
  for (const status of ["started", "pending", "applied", "repeated", "inspected", "reconciled", "closed", "rejected", "failed", "indeterminate"]) {
    assert.ok(statuses.includes(status), `missing status ${status}`);
  }
  const response = schema.$defs.response;
  assert.equal(response.properties.delivery.const, "captured");
  assert.deepEqual(response.properties.captureContext.enum, ["turn", "manual_resume"]);
  assert.equal(response.required.includes("redacted"), true);
  assert.equal(response.required.includes("redactionCodes"), true);
  const envelope = createResult({
    command: "turn",
    status: "applied",
    tenant: { id: "tenant", slug: "demo" },
    session: { id: "session", identityId: "identity", state: "active", createdAt: "2026-08-12T00:00:00.000Z", closedAt: null },
    turn: { id: "turn-1", state: "applied", retriable: false },
    responses: [{ type: "text", text: "ok", delivery: "captured", captureContext: "turn", redacted: false, redactionCodes: [] }],
    routing: { branch: "llm", reasonCode: "OK", ai: { attempted: true, used: true, provider: "gemini", model: "gemini-2.5-flash", outcome: "handled", operationTypes: ["show_menu"] } },
    warnings: ["SAFE_WARNING"],
  });
  assert.deepEqual(Object.keys(envelope).sort(), [...schema.required].sort());
  assert.deepEqual(envelope.warnings, ["SAFE_WARNING"]);
  assert.equal(envelope.responses[0].delivery, "captured");
});
