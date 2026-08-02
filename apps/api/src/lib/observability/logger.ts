export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

const sensitiveKeyPatterns = [
  /authorization/i,
  /api[_-]?key/i,
  /secret/i,
  /access[_-]?token/i,
  /^token$/i,
  /^phone$/i,
  /^from$/i,
  /^to$/i,
  /address/i,
  /billing/i,
  /^email$/i,
  /^raw$/i,
  /^payload$/i,
  /^body$/i,
  /^text$/i,
];

export function logEvent(
  level: LogLevel,
  event: string,
  message: string,
  fields: LogFields = {},
): void {
  const sanitizedFields = sanitizeLogFields(fields);
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    eventVersion: 1,
    message,
    service: "42day-api",
    ...(isRecord(sanitizedFields) ? sanitizedFields : {}),
  };

  if (level === "error") {
    console.error(entry);
    return;
  }
  if (level === "warn") {
    console.warn(entry);
    return;
  }
  if (level === "debug") {
    console.debug(entry);
    return;
  }
  console.info(entry);
}

export function sanitizeLogFields(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return "[max_depth]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 30).map((item) => sanitizeLogFields(item, depth + 1));
  }
  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      if (sensitiveKeyPatterns.some((pattern) => pattern.test(key))) {
        return [];
      }
      return [[key, sanitizeLogFields(item, depth + 1)]];
    }),
  );
}

export function safeErrorSummary(error: unknown): {
  name: string;
  code?: string;
  safeDetail: string;
} {
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
    return {
      name: error.name,
      code,
      safeDetail: sanitizeErrorDetail(error.message),
    };
  }

  return {
    name: "UnknownError",
    safeDetail: sanitizeErrorDetail(String(error)),
  };
}

export function sanitizeErrorDetail(detail: string, maxLength = 320): string {
  return detail
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|or|AIza)[-_A-Za-z0-9]{12,}\b/g, "[redacted]")
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[redacted-email]")
    .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, "[redacted-number]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
