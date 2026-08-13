import assert from "node:assert/strict";
import test from "node:test";
import { projectCapturedResponse } from "../src/features/chat-routing/outbound/capture.ts";
import { sanitizeErrorDetail, sanitizeLogFields } from "../src/lib/observability/logger.ts";

test("safe projection redacts phone, email and address markers without changing tenant capture", () => {
  const response = projectCapturedResponse({
    type: "text",
    text: "Dirección: Calle 1 # 2-3, contacto +57 300 123 4567, correo demo@example.com",
    captureContext: "turn",
    originatingTurnId: "turn-1",
  });
  assert.equal(response.redacted, true);
  assert.deepEqual(response.redactionCodes.sort(), ["EMAIL", "LOCATION_OR_BILLING", "PHONE"]);
  assert.doesNotMatch(response.text ?? "", /demo@example.com/);
});

test("safe projection does not flag empty address placeholders as sensitive data", () => {
  const response = projectCapturedResponse({
    type: "text",
    text: "Dirección: Pendiente\nIndicaciones: No requeridas para recoger",
    captureContext: "turn",
    originatingTurnId: "turn-2",
  });
  assert.equal(response.redacted, false);
  assert.deepEqual(response.redactionCodes, []);
  assert.match(response.text ?? "", /Dirección: Pendiente/);
});

test("headless diagnostics remove raw text, payloads, credentials and personal fields", () => {
  const fields = sanitizeLogFields({
    traceId: "trace-1",
    text: "Calle 1 # 2-3",
    payload: { secret: "no-log", phone: "+57 300 123 4567" },
    nested: { email: "demo@example.com", safeCode: "DATABASE_UNAVAILABLE" },
  });
  assert.deepEqual(fields, { traceId: "trace-1", nested: { safeCode: "DATABASE_UNAVAILABLE" } });
  const detail = sanitizeErrorDetail("Gemini failed for demo@example.com at +57 300 123 4567");
  assert.match(detail, /\[redacted-email\]/);
  assert.doesNotMatch(detail, /demo@example.com|300 123/);
});
