import type { SemanticParserResult } from "../../../modules/semantic-parser/semantic-parser";
import { logEvent } from "../../../lib/observability/logger.ts";
import type { ResponseRoutingTrace, RouteInboundMessageInput } from "./types";

export function logRoutingDiagnostic(input: RouteInboundMessageInput, event: string, payload: Record<string, unknown> = {}): void {
  const level = event.endsWith(".failed") || event.endsWith(".transaction_failed")
    ? "error"
    : event.endsWith(".rejected")
      ? "warn"
      : "info";
  logEvent(level, event, describeRoutingEvent(event), {
    environment: input.env.APP_ENV,
    traceId: input.traceId,
    tenantId: input.tenant.id,
    conversationId: input.conversation.id,
    inboundProviderMessageId: input.message.providerMessageId ?? null,
    conversationState: input.conversation.state,
    messageType: input.message.type,
    ...payload,
  });
}

export function markLlmAttempt(input: RouteInboundMessageInput): void {
  input.routingTrace = {
    ...(input.routingTrace ?? {}),
    llm: {
      attempted: true,
      used: false,
      outcome: "skipped_or_failed",
      provider: "gemini",
    },
  };
}

export function markRoutingDecision(
  input: RouteInboundMessageInput,
  branch: string,
  reason: string,
): void {
  input.routingTrace = {
    ...(input.routingTrace ?? {}),
    responseSource: "deterministic",
    responseReason: reason,
  };
  logRoutingDiagnostic(input, "routing.branch_selected", { branch, reason });
}

export function markLlmOutcome(input: RouteInboundMessageInput, payload: {
  used: boolean;
  outcome: NonNullable<ResponseRoutingTrace["llm"]>["outcome"];
  provider?: "gemini" | "openrouter" | "test_double";
  model?: string;
  reason?: string;
    parsed?: SemanticParserResult;
  operationTypes?: string[];
  diagnostics?: Record<string, unknown>;
}): void {
  input.routingTrace = {
    ...(input.routingTrace ?? {}),
    responseSource: payload.used ? "llm" : "deterministic_after_llm_fallback",
    responseReason: payload.reason,
    llm: {
      attempted: true,
      used: payload.used,
      outcome: payload.outcome,
      provider: payload.provider ?? "gemini",
      model: payload.model ?? input.routingTrace?.llm?.model,
      reason: payload.reason,
      intent: payload.parsed?.intent,
      confidence: payload.parsed?.confidence,
      itemCount: payload.parsed?.items.length,
      editActionCount: payload.parsed?.editActions?.length,
      operationTypes: payload.operationTypes ?? input.routingTrace?.llm?.operationTypes,
      parsed: payload.parsed ? redactSemanticParserResult(payload.parsed) : undefined,
      diagnostics: payload.diagnostics,
    },
  };
}

export function redactSemanticParserResult(parsed: SemanticParserResult): SemanticParserResult {
  return {
    ...parsed,
    addressText: parsed.addressText ? "[redacted]" : parsed.addressText,
    addressDetails: parsed.addressDetails ? "[redacted]" : parsed.addressDetails,
    draftFacts: parsed.draftFacts
      ? {
          ...parsed.draftFacts,
          deliveryAddressText: parsed.draftFacts.deliveryAddressText ? "[redacted]" : parsed.draftFacts.deliveryAddressText,
          deliveryAddressDetails: parsed.draftFacts.deliveryAddressDetails ? "[redacted]" : parsed.draftFacts.deliveryAddressDetails,
          billing: parsed.draftFacts.billing
            ? {
                type: parsed.draftFacts.billing.type,
                confidence: parsed.draftFacts.billing.confidence,
              }
            : parsed.draftFacts.billing,
        }
      : undefined,
  };
}

export function buildOutboundRoutingMetadata(input: RouteInboundMessageInput): Record<string, unknown> {
  const trace = input.routingTrace ?? {
    responseSource: "deterministic",
    responseReason: "default",
  };
  const responseSource =
    trace.responseSource ??
    (trace.llm?.attempted && !trace.llm.used ? "deterministic_after_llm_fallback" : "deterministic");

  return {
    routing: {
      traceId: input.traceId,
      responseSource,
      responseReason: trace.responseReason ?? null,
      decidedAt: new Date().toISOString(),
      conversationState: input.conversation.state,
      inboundProviderMessageId: input.message.providerMessageId ?? null,
      llm: trace.llm ?? {
        attempted: false,
        used: false,
      },
    },
  };
}

function describeRoutingEvent(event: string): string {
  const descriptions: Record<string, string> = {
    "chat_routing.message_received": "El enrutador recibió un mensaje normalizado.",
    "chat_routing.inbound_received": "El mensaje entrante está listo para seleccionar una ruta.",
    "routing.branch_selected": "El enrutador seleccionó la rama de procesamiento.",
    "semantic_operation_plan.completed": "El modelo generó un plan semántico estructurado.",
    "semantic_operation_plan.failed": "Ningún proveedor pudo generar el plan semántico.",
    "semantic_operation_plan.rejected": "El plan semántico fue rechazado por una validación del negocio.",
    "semantic_operation_plan.applied": "El plan semántico se aplicó al borrador.",
    "semantic_operation_plan.transaction_failed": "La operación del pedido falló y no se confirmó.",
    "semantic_operation_plan.alert_failed": "No se pudo persistir la alerta técnica del fallo semántico.",
    "semantic_delivery_address.coverage_evaluated": "Se evaluó la cobertura de la dirección.",
    "draft_facts.apply_started": "Comenzó la aplicación de datos estructurados al borrador.",
    "draft_facts.fulfillment_applied": "Se aplicó la modalidad de entrega al borrador.",
    "draft_facts.billing_applied": "Se aplicó la facturación al borrador.",
    "draft_facts.payment_applied": "Se aplicó el método de pago al borrador.",
    "draft_facts.apply_completed": "Terminó la aplicación de datos estructurados al borrador.",
  };

  return descriptions[event] ?? `Evento de enrutamiento: ${event}.`;
}
