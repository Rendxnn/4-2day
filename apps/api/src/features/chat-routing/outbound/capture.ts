import type { OutboundMessageResult } from "@42day/types";
import type {
  CapturedResponse,
  OutboundDeliveryInput,
  OutboundDeliveryPort,
  SafeTurnObserver,
} from "../ports";

export function createHeadlessCapture(input: {
  captureContext: "turn" | "manual_resume";
  originatingTurnId: string;
  observer?: SafeTurnObserver;
}): OutboundDeliveryPort {
  return {
    async sendText(delivery: OutboundDeliveryInput & { text: string }) {
      const response = projectCapturedResponse({
        type: "text",
        text: delivery.text,
        captureContext: delivery.captureContext ?? input.captureContext,
        originatingTurnId: delivery.originatingTurnId ?? input.originatingTurnId,
      });
      input.observer?.onResponse?.(response);
      return {
        result: capturedResult(),
        response,
      };
    },
  };
}

export function projectCapturedResponse(input: {
  type: "text" | "image";
  text?: string;
  caption?: string;
  captureContext: "turn" | "manual_resume";
  originatingTurnId?: string;
}): CapturedResponse {
  const projectedText = input.text === undefined ? undefined : redactSafeText(input.text);
  const projectedCaption = input.caption === undefined ? undefined : redactSafeText(input.caption);
  const redactionCodes = [
    ...(projectedText?.codes ?? []),
    ...(projectedCaption?.codes ?? []),
  ];

  return {
    type: input.type,
    ...(projectedText ? { text: projectedText.text } : {}),
    ...(projectedCaption ? { caption: projectedCaption.text } : {}),
    delivery: "captured",
    captureContext: input.captureContext,
    ...(input.originatingTurnId ? { originatingTurnId: input.originatingTurnId } : {}),
    redacted: redactionCodes.length > 0,
    redactionCodes: [...new Set(redactionCodes)],
  };
}

function capturedResult(): OutboundMessageResult {
  return {
    ok: true,
    httpStatus: 200,
    raw: { provider: "headless", delivery: "captured" },
  };
}

function redactSafeText(text: string): { text: string; codes: string[] } {
  const codes: string[] = [];
  let safeText = text;

  if (/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/.test(safeText)) {
    safeText = safeText.replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[EMAIL]");
    codes.push("EMAIL");
  }

  if (/(?:\+?\d[\d\s().-]{7,}\d)/.test(safeText)) {
    safeText = safeText.replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, "[PHONE]");
    codes.push("PHONE");
  }

  if (/\b(?:direcci[oó]n|address|billing|facturaci[oó]n)\s*:/i.test(safeText)) {
    safeText = safeText.replace(
      /((?:direcci[oó]n|address|billing|facturaci[oó]n)\s*:)\s*[^\n]+/gi,
      (line) => {
        const separator = line.indexOf(":");
        const value = line.slice(separator + 1).trim();
        if (/^(?:\[REDACTED\]|pendiente|no requerida?(?: para recoger)?|no requeridas?(?: para recoger)?)$/i.test(value)) {
          return line;
        }
        return `${line.slice(0, separator + 1)} [REDACTED]`;
      },
    );
    if (safeText !== text) {
      codes.push("LOCATION_OR_BILLING");
    }
  }

  return { text: safeText, codes };
}
