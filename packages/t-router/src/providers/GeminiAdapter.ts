import { assertProviderResponse, fetchWithTimeout, type ProviderFetch } from "../core/http.js";
import type { AiProviderAdapter, ProviderContext } from "../core/provider.js";
import type { AiInputPart, AiTask, AiTaskResult } from "../core/types.js";
import { AiRouterError } from "../errors/AiRouterError.js";

const defaultGeminiBaseUrl = "https://generativelanguage.googleapis.com";
const defaultGeminiModel = "gemini-2.5-flash";

export class GeminiAdapter implements AiProviderAdapter {
  readonly providerId = "gemini" as const;
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
    const model = input.task.model ?? input.context.credentials.model ?? input.context.defaultModel ?? defaultGeminiModel;
    const baseUrl = input.context.credentials.baseUrl ?? defaultGeminiBaseUrl;
    const response = await fetchWithTimeout(
      this.fetcher,
      `${baseUrl.replace(/\/$/, "")}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: buildGeminiHeaders(input.context),
        body: JSON.stringify(buildGeminiBody(input.task)),
      },
      this.timeoutMs,
    );

    await assertProviderResponse(response);
    const raw = await parseProviderJson(response, "response_body_json_parse");
    const outputText = extractGeminiText(raw);

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

function buildGeminiHeaders(context: ProviderContext): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (context.authMode === "api_key") {
    if (!context.credentials.apiKey) {
      throw new AiRouterError("provider_not_configured", "Gemini API key is missing.");
    }

    headers["x-goog-api-key"] = context.credentials.apiKey;
    return headers;
  }

  if (context.authMode === "oauth") {
    if (!context.credentials.accessToken) {
      throw new AiRouterError("provider_not_configured", "Gemini OAuth access token is missing.");
    }

    const googleCloudProjectId = context.credentials.googleCloudProjectId ?? context.credentials.extra?.googleCloudProjectId;

    if (!googleCloudProjectId) {
      throw new AiRouterError("provider_not_configured", "Gemini OAuth requires googleCloudProjectId.");
    }

    headers.Authorization = `Bearer ${context.credentials.accessToken}`;
    headers["x-goog-user-project"] = googleCloudProjectId;
    return headers;
  }

  throw new AiRouterError("provider_not_configured", "Gemini adapter supports API key or OAuth auth only.");
}

function buildGeminiBody(task: AiTask): Record<string, unknown> {
  const instructions = [task.system, task.instructions].filter(Boolean).join("\n\n");
  const parts = [
    ...(instructions ? [{ text: instructions }] : []),
    ...mapGeminiInput(task.input),
  ];
  const body: Record<string, unknown> = {
    contents: [
      {
        role: "user",
        parts,
      },
    ],
  };
  const generationConfig: Record<string, unknown> = {};

  if (task.temperature !== undefined) {
    generationConfig.temperature = task.temperature;
  }

  if (task.kind === "object") {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseJsonSchema = task.outputSchema;
  }

  if (Object.keys(generationConfig).length > 0) {
    body.generationConfig = generationConfig;
  }

  return body;
}

function mapGeminiInput(input: AiInputPart[]): Array<Record<string, unknown>> {
  return input.map((part) => {
    if (part.type === "text") {
      return { text: part.text };
    }

    if (part.type === "image_base64") {
      return {
        inlineData: {
          mimeType: part.mimeType,
          data: part.data,
        },
      };
    }

    if (part.type === "image_url") {
      return {
        fileData: {
          fileUri: part.url,
        },
      };
    }

    if (part.type === "file_uri") {
      return {
        fileData: {
          fileUri: part.uri,
          mimeType: part.mimeType,
        },
      };
    }

    return {
      fileData: {
        fileUri: part.url,
        mimeType: part.mimeType,
      },
    };
  });
}

function extractGeminiText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.candidates)) {
    throw new AiRouterError("provider_invalid_response", "Gemini response did not include candidates.");
  }

  const candidate = payload.candidates[0];

  if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) {
    throw new AiRouterError("provider_invalid_response", "Gemini response did not include content parts.");
  }

  for (const part of candidate.content.parts) {
    if (isRecord(part) && typeof part.text === "string") {
      return part.text;
    }
  }

  throw new AiRouterError("provider_invalid_response", "Gemini response did not include parseable output text.");
}

async function parseProviderJson(response: Response, stage: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new AiRouterError("provider_invalid_response", "Gemini response body was not valid JSON.", { stage });
  }
}

function parseObjectOutput<T>(outputText: string): T {
  try {
    return JSON.parse(outputText) as T;
  } catch {
    throw new AiRouterError("provider_invalid_response", "Gemini structured output was not valid JSON.", { stage: "object_output_json_parse" });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
