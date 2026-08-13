import { checkpointNormalizedInbound, finalizeNormalizedInbound, logInboundMessage } from "../../modules/message-log/message-log";
import { routeInboundMessage } from "./router";
import type { RouteInboundMessageInput } from "./shared/types";

/**
 * Shared post-normalization boundary used by transport adapters.
 * Webhook-specific verification and raw event idempotency stay outside it.
 */
export async function processNormalizedChatTurn(
  input: RouteInboundMessageInput,
): Promise<{ loggedMessageId: string; routingTrace: RouteInboundMessageInput["routingTrace"] }> {
  const loggedMessageId = input.loggedMessageId ?? (await logInboundMessage({
    env: input.env,
    schemaName: input.tenant.schemaName,
    conversationId: input.conversation.id,
    message: input.message,
  })).id;

  input.loggedMessageId = loggedMessageId;
  if (input.source === "headless") input.headlessEffectIds ??= [];
  const ownsCheckpoint = !input.beforeFirstEffect;
  let checkpointedManifest: import("./ports").ValidatedExecutionManifest | undefined;
  if (ownsCheckpoint) {
    input.beforeFirstEffect = async (manifest) => {
      await checkpointNormalizedInbound({
        env: input.env,
        schemaName: input.tenant.schemaName,
        messageId: loggedMessageId,
        manifest,
      });
      checkpointedManifest = manifest;
    };
  }
  await routeInboundMessage(input);
  if (ownsCheckpoint && checkpointedManifest) {
    await finalizeNormalizedInbound({
      env: input.env,
      schemaName: input.tenant.schemaName,
      messageId: loggedMessageId,
      postconditions: {
        manifestDigest: checkpointedManifest.digest,
        postconditionFingerprints: checkpointedManifest.postconditionFingerprints,
        effectIds: [loggedMessageId, ...(input.headlessEffectIds ?? [])],
        responseSource: input.routingTrace?.responseSource ?? null,
        operationTypes: input.routingTrace?.llm?.operationTypes ?? [],
      },
    });
  }

  return {
    loggedMessageId,
    routingTrace: input.routingTrace,
  };
}
