export type AiRouterErrorCode =
  | "provider_not_registered"
  | "provider_not_configured"
  | "provider_auth_failed"
  | "provider_network_error"
  | "provider_timeout"
  | "provider_unavailable"
  | "provider_quota_exceeded"
  | "provider_invalid_request"
  | "provider_invalid_response"
  | "provider_unknown_error"
  | "router_invalid_task";

export class AiRouterError extends Error {
  readonly code: AiRouterErrorCode;
  readonly causeData?: unknown;

  constructor(code: AiRouterErrorCode, message: string, causeData?: unknown) {
    super(message);
    this.name = "AiRouterError";
    this.code = code;
    this.causeData = causeData;
  }
}
