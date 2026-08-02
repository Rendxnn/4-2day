import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { redactSemanticParserResult } from "../src/features/chat-routing/shared/tracing.ts";
import { sanitizeErrorDetail, sanitizeLogFields } from "../src/lib/observability/logger.ts";

const operationPlanPath = new URL("../src/features/chat-routing/semantic/operation-plan.ts", import.meta.url);
const httpPath = new URL("../../../packages/t-router/src/core/http.ts", import.meta.url);

test("redacta facturacion y direccion del snapshot semantico", () => {
  const redacted = redactSemanticParserResult({
    intent: "unknown",
    confidence: 0.9,
    items: [],
    addressText: "Calle privada 123",
    addressDetails: "Apto privado 5",
    draftFacts: {
      deliveryAddressText: "Carrera privada 4",
      deliveryAddressDetails: "Torre privada",
      deliveryAddressConfidence: 0.9,
      billing: {
        type: "normal",
        fullName: "Samuel Rendon",
        billingAddress: "Direccion privada",
        confidence: 0.9,
      },
    },
  });

  assert.equal(redacted.addressText, "[redacted]");
  assert.equal(redacted.addressDetails, "[redacted]");
  assert.equal(redacted.draftFacts.deliveryAddressText, "[redacted]");
  assert.equal(redacted.draftFacts.deliveryAddressDetails, "[redacted]");
  assert.deepEqual(redacted.draftFacts.billing, { type: "normal", confidence: 0.9 });
});

test("los diagnosticos del proveedor conservan una causa segura y clasificable", async () => {
  const operationPlan = await readFile(operationPlanPath, "utf8");
  const http = await readFile(httpPath, "utf8");

  assert.match(operationPlan, /SemanticOperationPlanInferenceError/);
  assert.match(operationPlan, /upstreamHttpStatus/);
  assert.match(operationPlan, /fallbackFromProviderId/);
  assert.match(operationPlan, /safeProviderFailure/);
  assert.match(http, /httpStatus: response\.status/);
  assert.match(http, /reason: classified\.reason/);
  assert.match(http, /safeDetail: sanitizeProviderErrorDetail/);
  const diagnostic = http.match(/const diagnostic = \{[\s\S]*?\n  \};/)?.[0] ?? "";
  assert.doesNotMatch(diagnostic, /\bbody\b/);
});

test("el logger elimina secretos y datos personales antes de emitir eventos", () => {
  const sanitized = sanitizeLogFields({
    traceId: "PH-1234",
    provider: "openrouter",
    apiKey: "secret-value",
    phone: "573001112233",
    payload: { text: "pedido privado" },
    error: {
      reason: "invalid_schema",
      safeDetail: "detalle seguro",
    },
  });

  assert.deepEqual(sanitized, {
    traceId: "PH-1234",
    provider: "openrouter",
    error: {
      reason: "invalid_schema",
      safeDetail: "detalle seguro",
    },
  });
  assert.equal(
    sanitizeErrorDetail("Bearer abcdefghijklmnop user@example.com +57 300 111 2233"),
    "Bearer [redacted] [redacted-email] +[redacted-number]",
  );
});

test("el limite de operaciones se valida en runtime y no se envia al schema de Gemini", async () => {
  const operationPlan = await readFile(operationPlanPath, "utf8");
  const providerSchemaSection = operationPlan.match(/const semanticOperationPlanSchema = ([\s\S]*?)async function generateSemanticObject/)?.[1] ?? "";

  assert.doesNotMatch(providerSchemaSection, /operations:\s*\{\s*type:\s*"array",\s*maxItems:\s*12/);
  assert.match(operationPlan, /operations: z\.array\(semanticOperationSchema\)\.max\(12\)/);
});

test("clasifica errores de schema y cuota sin conservar el body completo", async () => {
  const http = await readFile(httpPath, "utf8");

  assert.match(http, /provider_invalid_request/);
  assert.match(http, /schema_too_complex/);
  assert.match(http, /simplify_response_schema/);
  assert.match(http, /provider_quota_exceeded/);
  assert.match(http, /insufficient_quota/);
  assert.match(http, /sanitizeProviderErrorDetail/);
});
