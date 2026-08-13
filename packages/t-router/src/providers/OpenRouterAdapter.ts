import { AiRouterError } from "../errors/AiRouterError.js";
import { assertProviderResponse, fetchWithTimeout, type ProviderFetch } from "../core/http.js";
import type { AiProviderAdapter } from "../core/provider.js";
import type { ProviderContext } from "../core/provider.js";
import type { AiInputPart, AiTask, AiTaskResult } from "../core/types.js";

const openRouterUrl = "https://openrouter.ai/api/v1/chat/completions";
const defaultOpenRouterModel = "openrouter/auto";

export class OpenRouterAdapter implements AiProviderAdapter {
  readonly providerId = "openrouter" as const;
  private readonly fetcher: ProviderFetch;
  private readonly timeoutMs: number;

  constructor(
    fetcher: ProviderFetch = fetch,
    timeoutMs = 45000,
  ) {
    this.fetcher = fetcher;
    this.timeoutMs = timeoutMs;
  }

  async execute<T = unknown>(input: { context: ProviderContext; task: AiTask }): Promise<AiTaskResult<T>> {
    if (input.context.authMode !== "api_key" && input.context.authMode !== "oauth") {
      throw new AiRouterError("provider_not_configured", "OpenRouter adapter supports API key or OAuth-derived key auth only.");
    }

    const apiKey = input.context.credentials.apiKey;

    if (!apiKey) {
      throw new AiRouterError("provider_not_configured", "OpenRouter API key is missing.");
    }

    const model = input.task.model ?? input.context.credentials.model ?? input.context.defaultModel ?? defaultOpenRouterModel;
    const response = await fetchWithTimeout(
      this.fetcher,
      openRouterUrl,
      {
        method: "POST",
        headers: buildHeaders(apiKey, input.context.credentials.extra),
        body: JSON.stringify(buildOpenRouterBody(model, input.task)),
      },
      this.timeoutMs,
    );

    await assertProviderResponse(response);
    const raw = await parseProviderJson(response, "response_body_json_parse");
    const outputText = extractOpenRouterText(raw);

    if (input.task.kind === "text") {
      return {
        kind: "text",
        providerId: this.providerId,
        model,
        outputText,
        raw,
      };
    }

    return {
      kind: "object",
      providerId: this.providerId,
      model,
      outputText,
      outputObject: parseObjectOutput<T>(outputText),
      raw,
    };
  }
}

function buildHeaders(apiKey: string, extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...(extra ?? {}),
  };
}

function buildOpenRouterBody(model: string, task: AiTask): Record<string, unknown> {
  const instructions = [task.system, task.instructions].filter(Boolean).join("\n\n");
  const body: Record<string, unknown> = {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: instructions },
          ...mapOpenRouterInput(task.input),
        ],
      },
    ],
  };

  if (task.temperature !== undefined) {
    body.temperature = task.temperature;
  }

  if (task.kind === "object") {
    body.provider = {
      require_parameters: true,
    };
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: task.schemaName,
        strict: true,
        schema: task.outputSchema,
      },
    };
  }

  return body;
}

function mapOpenRouterInput(input: AiInputPart[]): Array<Record<string, unknown>> {
  return input.map((part) => {
    if (part.type === "text") {
      return { type: "text", text: part.text };
    }

    if (part.type === "image_url") {
      return {
        type: "image_url",
        image_url: {
          url: part.url,
        },
      };
    }

    if (part.type === "image_base64") {
      return {
        type: "image_url",
        image_url: {
          url: `data:${part.mimeType};base64,${part.data}`,
        },
      };
    }

    if (part.type === "file_uri") {
      return {
        type: "text",
        text: `Archivo adjunto: ${part.uri}`,
      };
    }

    return {
      type: "text",
      text: `Archivo adjunto: ${part.url}`,
    };
  });
}

function extractOpenRouterText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    throw new AiRouterError("provider_invalid_response", "OpenRouter response did not include choices.");
  }

  const choice = payload.choices[0];

  if (!isRecord(choice) || !isRecord(choice.message)) {
    throw new AiRouterError("provider_invalid_response", "OpenRouter response did not include a message.");
  }

  const content = choice.message.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    for (const item of content) {
      if (isRecord(item) && typeof item.text === "string") {
        return item.text;
      }
    }
  }

  throw new AiRouterError("provider_invalid_response", "OpenRouter response did not include parseable output text.");
}

async function parseProviderJson(response: Response, stage: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new AiRouterError("provider_invalid_response", "OpenRouter response body was not valid JSON.", { stage });
  }
}

function parseObjectOutput<T>(outputText: string): T {
  try {
    return JSON.parse(outputText) as T;
  } catch {
    throw new AiRouterError("provider_invalid_response", "OpenRouter structured output was not valid JSON.", { stage: "object_output_json_parse" });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
