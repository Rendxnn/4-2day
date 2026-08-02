import { AiRouterError } from "../errors/AiRouterError.js";

export type ProviderFetch = typeof fetch;

export async function fetchWithTimeout(
  fetcher: ProviderFetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetcher(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new AiRouterError("provider_timeout", "AI provider request timed out.");
    }

    throw new AiRouterError("provider_network_error", "AI provider network request failed.", error);
  } finally {
    clearTimeout(timeout);
  }
}

export async function assertProviderResponse(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }

  const body = await response.text().catch(() => "");
  const parsed = parseProviderErrorBody(body);
  const classified = classifyProviderError(response.status, parsed.message, parsed.status);
  const diagnostic = {
    httpStatus: response.status,
    upstreamCode: parsed.code,
    upstreamStatus: parsed.status,
    reason: classified.reason,
    safeDetail: sanitizeProviderErrorDetail(parsed.message),
    retriable: classified.retriable,
    action: classified.action,
  };

  if (response.status === 401 || response.status === 403 || parsed.code === 401 || parsed.code === 403) {
    throw new AiRouterError("provider_auth_failed", parsed.message || "AI provider rejected the credentials.", diagnostic);
  }

  if (response.status === 408 || response.status === 504 || parsed.code === 408 || parsed.code === 504) {
    throw new AiRouterError("provider_timeout", parsed.message || "AI provider request timed out.", diagnostic);
  }

  if (
    response.status === 402 ||
    response.status === 429 ||
    parsed.code === 402 ||
    parsed.code === 429 ||
    parsed.status === "RESOURCE_EXHAUSTED" ||
    isQuotaError(parsed.message)
  ) {
    throw new AiRouterError("provider_quota_exceeded", parsed.message || "AI provider quota is exhausted.", diagnostic);
  }

  if (
    response.status === 502 ||
    response.status === 503 ||
    response.status === 529 ||
    parsed.code === 502 ||
    parsed.code === 503 ||
    parsed.code === 529 ||
    parsed.status === "UNAVAILABLE" ||
    parsed.message.toLowerCase().includes("no available model provider")
  ) {
    throw new AiRouterError("provider_unavailable", parsed.message || "AI provider is unavailable.", diagnostic);
  }

  if (response.status >= 500) {
    throw new AiRouterError("provider_unavailable", parsed.message || "AI provider is unavailable.", diagnostic);
  }

  if (
    response.status === 400 ||
    response.status === 404 ||
    response.status === 409 ||
    response.status === 412 ||
    response.status === 413 ||
    response.status === 422 ||
    parsed.code === 400 ||
    parsed.code === 404 ||
    parsed.code === 409 ||
    parsed.code === 412 ||
    parsed.code === 413 ||
    parsed.code === 422
  ) {
    throw new AiRouterError("provider_invalid_request", parsed.message || "AI provider rejected the request.", diagnostic);
  }

  throw new AiRouterError("provider_unknown_error", parsed.message || `AI provider failed with status ${response.status}.`, diagnostic);
}

export function parseProviderErrorBody(body: string): {
  code?: number | string;
  message: string;
  status?: string;
} {
  if (!body.trim()) {
    return { message: "" };
  }

  try {
    const payload = JSON.parse(body) as unknown;
    const errorPayload = isRecord(payload) && isRecord(payload.error) ? payload.error : payload;

    return {
      message: isRecord(errorPayload) && typeof errorPayload.message === "string" ? errorPayload.message : body,
      status: isRecord(errorPayload) && typeof errorPayload.status === "string" ? errorPayload.status : undefined,
      code:
        isRecord(errorPayload) && (typeof errorPayload.code === "string" || typeof errorPayload.code === "number")
          ? errorPayload.code
          : undefined,
    };
  } catch {
    return { message: body };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isQuotaError(message: string): boolean {
  const normalized = message.toLowerCase();

  return (
    normalized.includes("quota") ||
    normalized.includes("rate limit") ||
    normalized.includes("daily limit") ||
    normalized.includes("free tier") ||
    normalized.includes("credits")
  );
}

function classifyProviderError(
  httpStatus: number,
  message: string,
  upstreamStatus?: string,
): { reason: string; retriable: boolean; action: string } {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("too many states") ||
    normalized.includes("schema produces a constraint") ||
    normalized.includes("schema complexity")
  ) {
    return { reason: "schema_too_complex", retriable: false, action: "simplify_response_schema" };
  }
  if (
    normalized.includes("invalid schema") ||
    normalized.includes("json schema") ||
    normalized.includes("response_format") ||
    normalized.includes("response format")
  ) {
    return { reason: "invalid_output_schema", retriable: false, action: "review_response_schema" };
  }
  if (
    normalized.includes("does not support") ||
    normalized.includes("unsupported parameter") ||
    normalized.includes("require_parameters")
  ) {
    return { reason: "unsupported_provider_parameter", retriable: false, action: "select_compatible_model" };
  }
  if (normalized.includes("model") && (normalized.includes("not found") || normalized.includes("invalid"))) {
    return { reason: "invalid_model", retriable: false, action: "configure_supported_model" };
  }
  if (isQuotaError(message) || httpStatus === 402 || httpStatus === 429 || upstreamStatus === "RESOURCE_EXHAUSTED") {
    return { reason: httpStatus === 429 ? "rate_limited" : "insufficient_quota", retriable: httpStatus === 429, action: "review_provider_quota" };
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return { reason: "authentication_failed", retriable: false, action: "review_provider_credentials" };
  }
  if (httpStatus === 408 || httpStatus === 504) {
    return { reason: "provider_timeout", retriable: true, action: "retry_or_use_fallback" };
  }
  if (httpStatus >= 500 || upstreamStatus === "UNAVAILABLE") {
    return { reason: "provider_unavailable", retriable: true, action: "retry_or_use_fallback" };
  }
  if (httpStatus >= 400 && httpStatus < 500) {
    return { reason: "invalid_request", retriable: false, action: "review_provider_request" };
  }
  return { reason: "unknown_provider_error", retriable: false, action: "inspect_provider_diagnostics" };
}

function sanitizeProviderErrorDetail(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|or|AIza)[-_A-Za-z0-9]{12,}\b/g, "[redacted]")
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[redacted-email]")
    .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, "[redacted-number]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}
