import { AiRouterError } from "../errors/AiRouterError.js";
import { assertProviderResponse, fetchWithTimeout, type ProviderFetch } from "../core/http.js";
import type { AiProviderAdapter } from "../core/provider.js";
import type { ProviderContext } from "../core/provider.js";
import type { AiInputPart, AiTask, AiTaskResult } from "../core/types.js";

const openAiResponsesUrl = "https://api.openai.com/v1/responses";
const defaultOpenAiModel = "gpt-4.1-mini";

export class OpenAiAdapter implements AiProviderAdapter {
  readonly providerId = "openai" as const;
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
    if (input.context.authMode !== "api_key") {
      throw new AiRouterError("provider_not_configured", "OpenAI adapter currently supports API key auth only.");
    }

    const apiKey = input.context.credentials.apiKey;

    if (!apiKey) {
      throw new AiRouterError("provider_not_configured", "OpenAI API key is missing.");
    }

    const model = input.task.model ?? input.context.credentials.model ?? input.context.defaultModel ?? defaultOpenAiModel;
    const response = await fetchWithTimeout(
      this.fetcher,
      openAiResponsesUrl,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildOpenAiBody(model, input.task)),
      },
      this.timeoutMs,
    );

    await assertProviderResponse(response);
    const raw = (await response.json()) as unknown;
    const outputText = extractOpenAiText(raw);

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
      outputObject: JSON.parse(outputText) as T,
      raw,
    };
  }
}

function buildOpenAiBody(model: string, task: AiTask): Record<string, unknown> {
  const userContent = mapOpenAiInput(task.input);
  const instructions = [task.system, task.instructions].filter(Boolean).join("\n\n");
  const body: Record<string, unknown> = {
    model,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: instructions },
          ...userContent,
        ],
      },
    ],
  };

  if (task.temperature !== undefined) {
    body.temperature = task.temperature;
  }

  if (task.kind === "object") {
    body.text = {
      format: {
        type: "json_schema",
        name: task.schemaName,
        schema: task.outputSchema,
        strict: true,
      },
    };
  }

  return body;
}

function mapOpenAiInput(input: AiInputPart[]): Array<Record<string, unknown>> {
  return input.map((part) => {
    if (part.type === "text") {
      return { type: "input_text", text: part.text };
    }

    if (part.type === "image_url") {
      return {
        type: "input_image",
        image_url: part.url,
        detail: part.detail ?? "auto",
      };
    }

    if (part.type === "image_base64") {
      return {
        type: "input_image",
        image_url: `data:${part.mimeType};base64,${part.data}`,
        detail: part.detail ?? "auto",
      };
    }

    if (part.type === "file_uri") {
      return {
        type: "input_file",
        file_url: part.uri,
      };
    }

    return {
      type: "input_file",
      file_url: part.url,
    };
  });
}

function extractOpenAiText(payload: unknown): string {
  if (isRecord(payload) && typeof payload.output_text === "string") {
    return payload.output_text;
  }

  if (!isRecord(payload) || !Array.isArray(payload.output)) {
    throw new AiRouterError("provider_invalid_response", "OpenAI response did not include output text.");
  }

  for (const outputItem of payload.output) {
    if (!isRecord(outputItem) || !Array.isArray(outputItem.content)) {
      continue;
    }

    for (const contentItem of outputItem.content) {
      if (isRecord(contentItem) && typeof contentItem.text === "string") {
        return contentItem.text;
      }
    }
  }

  throw new AiRouterError("provider_invalid_response", "OpenAI response did not include parseable output text.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
