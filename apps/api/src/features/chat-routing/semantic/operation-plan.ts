import { AiProviderRouter, AiRouterError, createObjectTask, GeminiAdapter, OpenRouterAdapter } from "@rendxnn/t-router";
import type { Conversation, DraftOrder, TodayMenuPayload } from "@42day/types";
import { z } from "zod";
import type { ApiBindings } from "../../../lib/bindings";
import { logEvent } from "../../../lib/observability/logger.ts";
import { loadTenantAiFallbackProviderConfig, loadTenantAiProviderConfig } from "../../../modules/ai-provider-config/ai-provider-config";

type SemanticProviderConfig = NonNullable<Awaited<ReturnType<typeof loadTenantAiProviderConfig>>>;

export type SemanticConfigurationSelection = {
  optionId: string;
  valueIds?: string[];
  textValue?: string | null;
};

export type SemanticBillingInput = {
  type: "normal" | "electronic";
  fullName?: string | null;
  billingAddress?: string | null;
  legalName?: string | null;
  taxId?: string | null;
  email?: string | null;
};

export type SemanticOperation = {
  type:
    | "add_product"
    | "remove_draft_line"
    | "set_line_quantity"
    | "set_line_notes"
    | "set_line_configuration"
    | "set_fulfillment"
    | "set_payment_method"
    | "set_delivery_address"
    | "set_billing"
    | "continue_checkout"
    | "confirm_order"
    | "edit_order"
    | "cancel_order"
    | "reuse_billing_profile"
    | "change_billing"
    | "switch_to_electronic_billing"
    | "accept_cash_fallback"
    | "keep_transfer"
    | "request_human"
    | "show_menu"
    | "get_order_status";
  menuItemId?: string | null;
  draftOrderItemId?: string | null;
  quantity?: number | null;
  configuration?: SemanticConfigurationSelection[];
  notes?: string[] | null;
  fulfillmentType?: "delivery" | "pickup" | null;
  paymentMethod?: "cash" | "transfer" | null;
  addressText?: string | null;
  addressDetails?: string | null;
  billing?: SemanticBillingInput | null;
  confidence?: number;
};

export type SemanticOperationPlan = {
  confidence: number;
  operations: SemanticOperation[];
};

export type SemanticOperationExecution = {
  providerId: "gemini" | "openrouter" | "test_double";
  fallbackFromProviderId?: "gemini" | "openrouter";
  plan: SemanticOperationPlan;
  attempts: SemanticProviderAttempt[];
};

export type SemanticProviderAttempt = {
  provider: "gemini" | "openrouter" | "test_double";
  model?: string;
  outcome: "succeeded" | "failed" | "not_configured";
  durationMs?: number;
  errorCode?: string;
  upstreamHttpStatus?: number;
  upstreamCode?: string | number;
  upstreamStatus?: string;
  failureStage?: string;
  reason?: string;
  safeDetail?: string;
  retriable?: boolean;
  action?: string;
  validationIssues?: Array<{ path: string; code: string }>;
};

export class SemanticOperationPlanInferenceError extends Error {
  readonly attempts: SemanticProviderAttempt[];
  readonly finalError: unknown;

  constructor(
    attempts: SemanticProviderAttempt[],
    finalError: unknown,
  ) {
    super("semantic_operation_plan_inference_failed");
    this.name = "SemanticOperationPlanInferenceError";
    this.attempts = attempts;
    this.finalError = finalError;
  }
}

export async function parseSemanticOperationPlan(input: {
  env: ApiBindings;
  tenantId: string;
  traceId: string;
  rawMessage: string;
  conversation: Conversation;
  menu: TodayMenuPayload;
  draft: DraftOrder | null;
  lastAssistantPrompt?: string;
  allowedOperations: SemanticOperation["type"][];
  pendingAdjustment?: { unavailableMenuItemIds: string[] };
  pendingConfiguration?: {
    menuItemId: string;
    quantity: number;
    pendingOptionId: string;
    configuration: SemanticConfigurationSelection[];
    notes: string[];
  };
  generation?: import("../ports").SemanticGenerationPort;
}): Promise<SemanticOperationExecution> {
  if (input.generation) {
    const raw = await input.generation.generate({
      rawMessage: input.rawMessage,
      conversationState: input.conversation.state,
      allowedOperations: input.allowedOperations,
      context: {
        lastAssistantPrompt: input.lastAssistantPrompt ?? null,
        pendingAdjustment: input.pendingAdjustment ?? null,
        pendingConfiguration: input.pendingConfiguration ?? null,
        menu: summarizeMenu(input.menu),
        draft: summarizeDraft(input.draft),
      },
    });
    return {
      providerId: "test_double",
      plan: validateSemanticOperationPlanOutput(raw),
      attempts: [{ provider: "test_double", outcome: "succeeded", action: "injected_test_generation" }],
    };
  }
  const task = createObjectTask({
    schemaName: "semantic_order_operation_plan",
    outputSchema: semanticOperationPlanSchema,
    temperature: 0,
    instructions: [
      "Interpreta un mensaje de WhatsApp para un pedido de restaurante.",
      "Responde SOLO un plan JSON conforme al schema. Nunca llames herramientas.",
      "Usa exclusivamente IDs que aparezcan en el contexto; no inventes IDs, precios, totales, disponibilidad ni estados.",
      "Solo usa operaciones incluidas en allowedOperations. Si no puedes determinar una operación válida, devuelve operations vacío.",
      "Para consultar el estado de un pedido usa get_order_status; no inventes estados ni identificadores.",
      "Para agregar productos usa add_product con menuItemId y cantidad. Para editar o retirar una línea existente usa siempre draftOrderItemId exacto.",
      "Para cambiar una configuración entrega optionId y valueIds; para opciones libres usa textValue. No uses nombres de producto u opción como referencias.",
      "Una frase con 'con' puede incluir productos independientes del menú. Si 'carne a la plancha' y 'jugo de fresa' tienen menuItemId distintos, genera una operación add_product por cada uno; no conviertas el jugo en configuración de la carne.",
      "Usa configuration únicamente para optionId y valueIds que pertenezcan al producto principal. Conserva una elección como 'de res' si es una opción real del plato. Nunca declares que un producto está agotado: el servidor valida la disponibilidad real.",
      "Una sustitución es remove_draft_line más una o más add_product. Si hay exactamente un producto agotado y el cliente no dice cantidad del reemplazo, deja quantity null para preservar esa cantidad.",
      "‘Otra’, ‘otro’, ‘dame otra’ o ‘dame otras’ sobre un producto significa agregar una unidad adicional; no repitas ni reemplaces las líneas que ya existen. Si el cliente dice una cantidad nueva explícita, agrega exactamente esa cantidad.",
      "Setea entrega y pago únicamente cuando el mensaje actual los expresa de forma explícita. Nunca los deduzcas del tipo de producto, de la dirección, de preferencias comunes ni del estado anterior.",
      "Si el cliente cancela explícitamente un pedido pendiente de ajuste por agotados, usa cancel_order sin combinarla con otras operaciones.",
      "En una dirección, addressText siempre conserva la vía y su numeración completa. Un número colombiano con # es parte de la dirección, nunca addressDetails. addressDetails solo es para instrucciones separadas de entrega (apto, torre, bloque, unidad, urbanización, casa, portería o referencia).",
      "Ejemplo obligatorio: para ‘Calle 58 sur #42 99. Urbanización San Antonio 2 Casa 166’, devuelve set_delivery_address con addressText ‘Calle 58 sur #42 99’ y addressDetails ‘Urbanización San Antonio 2 Casa 166’.",
      "En awaiting_billing_reuse_confirmation: ‘así está bien’, ‘sigue igual’ o ‘déjala igual’ usan reuse_billing_profile; cambiar datos usa change_billing; pedir factura electrónica usa switch_to_electronic_billing. Nunca uses set_billing sin datos nuevos completos.",
      "En awaiting_confirmation: aceptar usa confirm_order y pedir cambios usa edit_order. En awaiting_transfer_fallback_payment_method: aceptar efectivo usa accept_cash_fallback y mantener transferencia usa keep_transfer.",
      "No uses set_fulfillment, set_payment_method, set_delivery_address ni set_billing durante un ajuste por agotados.",
      "Usa request_human solo cuando el cliente lo solicite explícitamente o necesite atención humana.",
    ].join("\n"),
    input: [{
      type: "text",
      text: JSON.stringify({
        message: input.rawMessage,
        conversationState: input.conversation.state,
        lastAssistantPrompt: input.lastAssistantPrompt ?? null,
        allowedOperations: input.allowedOperations,
        pendingAdjustment: input.pendingAdjustment ?? null,
        pendingConfiguration: input.pendingConfiguration ?? null,
        menu: summarizeMenu(input.menu),
        draft: summarizeDraft(input.draft),
      }),
    }],
  });

  const router = new AiProviderRouter([new GeminiAdapter(), new OpenRouterAdapter()]);
  const execution = await generateSemanticObject<SemanticOperationPlan>({
    env: input.env,
    tenantId: input.tenantId,
    router,
    task,
    validateOutput: validateSemanticOperationPlanOutput,
    onAttemptStarted: (provider) => {
      logEvent("debug", "ai.provider.attempt_started", `Iniciando un intento con ${provider.providerId}.`, {
        environment: input.env.APP_ENV,
        traceId: input.traceId,
        tenantId: input.tenantId,
        conversationId: input.conversation.id,
        conversationState: input.conversation.state,
        provider: provider.providerId,
        model: provider.defaultModel,
        schemaName: "semantic_order_operation_plan",
        schemaVersion: 2,
      });
    },
    onAttemptCompleted: (attempt) => {
      logEvent(
        attempt.outcome === "succeeded" ? "info" : "warn",
        attempt.outcome === "succeeded" ? "ai.provider.attempt_succeeded" : "ai.provider.attempt_failed",
        attempt.outcome === "succeeded"
          ? `${attempt.provider} generó una respuesta estructurada válida.`
          : `${attempt.provider} no pudo generar una respuesta estructurada válida.`,
        {
          environment: input.env.APP_ENV,
          traceId: input.traceId,
          tenantId: input.tenantId,
          conversationId: input.conversation.id,
          provider: attempt.provider,
          model: attempt.model,
          durationMs: attempt.durationMs,
          error: attempt.outcome === "failed" ? {
            code: attempt.errorCode,
            httpStatus: attempt.upstreamHttpStatus,
            upstreamCode: attempt.upstreamCode,
            upstreamStatus: attempt.upstreamStatus,
            stage: attempt.failureStage,
            reason: attempt.reason,
            safeDetail: attempt.safeDetail,
            retriable: attempt.retriable,
            action: attempt.action,
            validationIssues: attempt.validationIssues,
          } : undefined,
        },
      );
    },
    onFallbackStarted: (fromProvider, toProvider, reason) => {
      logEvent("warn", "ai.fallback.started", `Se intentará ${toProvider.providerId} porque ${fromProvider ?? "el proveedor principal"} falló.`, {
        environment: input.env.APP_ENV,
        traceId: input.traceId,
        tenantId: input.tenantId,
        conversationId: input.conversation.id,
        fromProvider,
        toProvider: toProvider.providerId,
        toModel: toProvider.defaultModel,
        fallbackReason: safeProviderFailure(reason),
      });
    },
  });
  return { providerId: execution.providerId, fallbackFromProviderId: execution.fallbackFromProviderId, plan: execution.output, attempts: execution.attempts };
}

export function allowedSemanticOperations(state: Conversation["state"]): SemanticOperation["type"][] {
  if (state === "awaiting_order_adjustment") {
    return ["add_product", "remove_draft_line", "set_line_quantity", "set_line_notes", "set_line_configuration", "confirm_order", "cancel_order", "request_human"];
  }
  if (state === "awaiting_product_configuration") {
    return ["add_product", "request_human", "show_menu", "get_order_status"];
  }
  if (state === "awaiting_billing_reuse_confirmation") {
    return ["reuse_billing_profile", "change_billing", "switch_to_electronic_billing", "request_human", "show_menu", "get_order_status"];
  }
  if (state === "awaiting_confirmation") {
    return ["confirm_order", "edit_order", "request_human", "show_menu", "get_order_status"];
  }
  if (state === "awaiting_transfer_fallback_payment_method") {
    return ["accept_cash_fallback", "keep_transfer", "request_human"];
  }
  if (state === "awaiting_transfer_proof" || state === "awaiting_restaurant_confirmation") {
    return ["request_human"];
  }
  return [
    "add_product", "remove_draft_line", "set_line_quantity", "set_line_notes", "set_line_configuration",
    "set_fulfillment", "set_payment_method", "set_delivery_address", "set_billing",
    "continue_checkout", "confirm_order", "request_human", "show_menu", "get_order_status",
  ];
}

function summarizeMenu(menu: TodayMenuPayload) {
  return menu.items
    .filter((item) => item.isAvailable && item.product?.isActive !== false)
    .map((item) => ({
      menuItemId: item.id,
      name: item.displayName ?? item.product?.name,
      aliases: [...(item.aliases ?? []), ...(item.product?.aliases ?? [])],
      displayPrice: item.priceOverride ?? item.product?.basePrice ?? 0,
      options: item.product?.options?.map((option) => ({
        optionId: option.id,
        name: option.name,
        type: option.type,
        required: option.isRequired,
        minSelect: option.minSelect,
        maxSelect: option.maxSelect,
        values: option.type === "text" ? [] : option.values.filter((value) => value.isActive).map((value) => ({ valueId: value.id, name: value.name })),
      })),
    }));
}

function summarizeDraft(draft: DraftOrder | null) {
  if (!draft) return null;
  return {
    draftOrderId: draft.id,
    items: draft.items.map((item) => ({
      draftOrderItemId: item.id,
      menuItemId: item.menuItemId,
      name: item.name,
      quantity: item.quantity,
      notes: item.notes ?? null,
      configuration: item.options?.resolvedOptions?.map((option) => ({
        optionId: option.optionId,
        valueIds: option.selectedValues?.map((value) => value.valueId),
        textValue: option.textValue,
      })) ?? [],
    })),
    fulfillmentType: draft.fulfillmentType ?? null,
    paymentMethod: draft.paymentMethod ?? null,
    hasAddress: Boolean(draft.resolvedDeliveryAddress ?? draft.customerAddressText ?? draft.deliveryAddress),
    billingType: draft.billing?.type ?? null,
  };
}

const semanticOperationPlanSchema = {
  type: "object",
  additionalProperties: false,
  required: ["confidence", "operations"],
  properties: {
    confidence: { type: "number", minimum: 0, maximum: 1 },
    operations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type"],
        properties: {
          type: { type: "string", enum: ["add_product", "remove_draft_line", "set_line_quantity", "set_line_notes", "set_line_configuration", "set_fulfillment", "set_payment_method", "set_delivery_address", "set_billing", "continue_checkout", "confirm_order", "edit_order", "cancel_order", "reuse_billing_profile", "change_billing", "switch_to_electronic_billing", "accept_cash_fallback", "keep_transfer", "request_human", "show_menu", "get_order_status"] },
          menuItemId: { type: ["string", "null"] },
          draftOrderItemId: { type: ["string", "null"] },
          quantity: { type: ["number", "null"], minimum: 1, maximum: 100 },
          configuration: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["optionId"],
              properties: {
                optionId: { type: "string" },
                valueIds: { type: "array", items: { type: "string" }, maxItems: 10 },
                textValue: { type: ["string", "null"] },
              },
            },
          },
          notes: { type: ["array", "null"], items: { type: "string" }, maxItems: 8 },
          fulfillmentType: { type: ["string", "null"], enum: ["delivery", "pickup", null] },
          paymentMethod: { type: ["string", "null"], enum: ["cash", "transfer", null] },
          addressText: { type: ["string", "null"] },
          addressDetails: { type: ["string", "null"] },
          billing: {
            type: ["object", "null"],
            additionalProperties: false,
            properties: {
              type: { type: "string", enum: ["normal", "electronic"] },
              fullName: { type: ["string", "null"] },
              billingAddress: { type: ["string", "null"] },
              legalName: { type: ["string", "null"] },
              taxId: { type: ["string", "null"] },
              email: { type: ["string", "null"] },
            },
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
  },
};

async function generateSemanticObject<T>(input: {
  env: ApiBindings;
  tenantId: string;
  router: AiProviderRouter;
  task: ReturnType<typeof createObjectTask>;
  validateOutput?: (value: unknown) => T;
  onAttemptStarted?: (provider: SemanticProviderConfig) => void;
  onAttemptCompleted?: (attempt: SemanticProviderAttempt) => void;
  onFallbackStarted?: (
    fromProvider: "gemini" | "openrouter" | undefined,
    toProvider: SemanticProviderConfig,
    reason: unknown,
  ) => void;
}): Promise<{ providerId: "gemini" | "openrouter"; output: T; fallbackFromProviderId?: "gemini" | "openrouter"; attempts: SemanticProviderAttempt[] }> {
  const provider = await loadTenantAiProviderConfig({ env: input.env, tenantId: input.tenantId });
  const attempts: SemanticProviderAttempt[] = [];
  let primaryError: unknown = new Error("semantic_parser.not_configured");

  if (provider) {
    try {
      const output = await runProviderAttempt<T>(input, provider, attempts);
      return { providerId: provider.providerId, output, attempts };
    } catch (error) {
      primaryError = error;
    }
  } else {
    attempts.push({ provider: "gemini", outcome: "not_configured", errorCode: "provider_not_configured" });
  }

  const fallbackProvider = await loadTenantAiFallbackProviderConfig({
    env: input.env,
    tenantId: input.tenantId,
    excludeProviderId: provider?.providerId,
  });
  if (fallbackProvider && shouldAttemptFallback(primaryError)) {
    input.onFallbackStarted?.(provider?.providerId, fallbackProvider, primaryError);
    try {
      const output = await runProviderAttempt<T>(input, fallbackProvider, attempts);
      return {
        providerId: fallbackProvider.providerId,
        fallbackFromProviderId: provider?.providerId,
        output,
        attempts,
      };
    } catch (error) {
      throw new SemanticOperationPlanInferenceError(attempts, error);
    }
  }

  throw new SemanticOperationPlanInferenceError(attempts, primaryError);
}

async function runProviderAttempt<T>(
  input: {
    router: AiProviderRouter;
    task: ReturnType<typeof createObjectTask>;
    validateOutput?: (value: unknown) => T;
    onAttemptStarted?: (provider: SemanticProviderConfig) => void;
    onAttemptCompleted?: (attempt: SemanticProviderAttempt) => void;
  },
  provider: SemanticProviderConfig,
  attempts: SemanticProviderAttempt[],
): Promise<T> {
  const startedAt = Date.now();
  input.onAttemptStarted?.(provider);
  try {
    const rawOutput = await input.router.generateObject<unknown>({ provider, task: input.task });
    const output = input.validateOutput ? input.validateOutput(rawOutput) : rawOutput as T;
    const attempt: SemanticProviderAttempt = {
      provider: provider.providerId,
      model: provider.defaultModel,
      outcome: "succeeded",
      durationMs: Date.now() - startedAt,
    };
    attempts.push(attempt);
    input.onAttemptCompleted?.(attempt);
    return output;
  } catch (error) {
    const attempt: SemanticProviderAttempt = {
      provider: provider.providerId,
      model: provider.defaultModel,
      outcome: "failed",
      durationMs: Date.now() - startedAt,
      ...safeProviderFailure(error),
    };
    attempts.push(attempt);
    input.onAttemptCompleted?.(attempt);
    throw error;
  }
}

export function semanticOperationPlanFailureDiagnostics(error: unknown): Record<string, unknown> {
  if (error instanceof SemanticOperationPlanInferenceError) {
    return {
      attempts: error.attempts,
      finalFailure: safeProviderFailure(error.finalError),
    };
  }

  return { attempts: [], finalFailure: safeProviderFailure(error) };
}

function shouldAttemptFallback(error: unknown): boolean {
  return !(error instanceof AiRouterError) || error.code !== "router_invalid_task";
}

function safeProviderFailure(error: unknown): Omit<SemanticProviderAttempt, "provider" | "model" | "outcome" | "durationMs"> {
  if (error instanceof AiRouterError) {
    const cause = isRecord(error.causeData) ? error.causeData : {};
    return {
      errorCode: error.code,
      upstreamHttpStatus: typeof cause.httpStatus === "number" ? cause.httpStatus : undefined,
      upstreamCode: typeof cause.upstreamCode === "string" || typeof cause.upstreamCode === "number" ? cause.upstreamCode : undefined,
      upstreamStatus: typeof cause.upstreamStatus === "string" ? cause.upstreamStatus : undefined,
      failureStage: typeof cause.stage === "string" ? cause.stage : undefined,
      reason: typeof cause.reason === "string" ? cause.reason : undefined,
      safeDetail: typeof cause.safeDetail === "string" ? cause.safeDetail : undefined,
      retriable: typeof cause.retriable === "boolean" ? cause.retriable : undefined,
      action: typeof cause.action === "string" ? cause.action : undefined,
      validationIssues: Array.isArray(cause.validationIssues)
        ? cause.validationIssues.flatMap((issue) => isRecord(issue) && typeof issue.path === "string" && typeof issue.code === "string"
          ? [{ path: issue.path, code: issue.code }]
          : [])
        : undefined,
    };
  }

  return {
    errorCode: error instanceof SyntaxError ? "output_json_parse_failed" : "unknown_failure",
    failureStage: error instanceof SyntaxError ? "object_output_json_parse" : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const semanticOperationTypeSchema = z.enum([
  "add_product",
  "remove_draft_line",
  "set_line_quantity",
  "set_line_notes",
  "set_line_configuration",
  "set_fulfillment",
  "set_payment_method",
  "set_delivery_address",
  "set_billing",
  "continue_checkout",
  "confirm_order",
  "edit_order",
  "cancel_order",
  "reuse_billing_profile",
  "change_billing",
  "switch_to_electronic_billing",
  "accept_cash_fallback",
  "keep_transfer",
  "request_human",
  "show_menu",
  "get_order_status",
]);

const semanticConfigurationSelectionSchema = z.object({
  optionId: z.string(),
  valueIds: z.array(z.string()).max(10).optional(),
  textValue: z.string().nullable().optional(),
}).strict();

const semanticBillingSchema = z.object({
  type: z.enum(["normal", "electronic"]),
  fullName: z.string().nullable().optional(),
  billingAddress: z.string().nullable().optional(),
  legalName: z.string().nullable().optional(),
  taxId: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
}).strict();

const semanticOperationSchema = z.object({
  type: semanticOperationTypeSchema,
  menuItemId: z.string().nullable().optional(),
  draftOrderItemId: z.string().nullable().optional(),
  quantity: z.number().min(1).max(100).nullable().optional(),
  configuration: z.array(semanticConfigurationSelectionSchema).optional(),
  notes: z.array(z.string()).max(8).nullable().optional(),
  fulfillmentType: z.enum(["delivery", "pickup"]).nullable().optional(),
  paymentMethod: z.enum(["cash", "transfer"]).nullable().optional(),
  addressText: z.string().nullable().optional(),
  addressDetails: z.string().nullable().optional(),
  billing: semanticBillingSchema.nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
}).strict();

const semanticOperationPlanRuntimeSchema = z.object({
  confidence: z.number().min(0).max(1),
  operations: z.array(semanticOperationSchema).max(12),
}).strict();

function validateSemanticOperationPlanOutput(value: unknown): SemanticOperationPlan {
  const parsed = semanticOperationPlanRuntimeSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw new AiRouterError(
    "provider_invalid_response",
    "AI provider returned JSON that does not match the semantic operation plan schema.",
    {
      stage: "output_schema_validation",
      reason: "output_schema_invalid",
      retriable: true,
      action: "try_fallback_or_review_prompt",
      validationIssues: parsed.error.issues.slice(0, 12).map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
      })),
    },
  );
}
