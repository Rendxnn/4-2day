import type { HeadlessEffectRecord, NormalizedChatEffect } from "../ports";
import type { RouteInboundMessageInput } from "./types";
import { updateConversationState } from "../../conversations/service";

type ConversationStateUpdate = Parameters<typeof updateConversationState>[0];

/**
 * Persists a route-owned conversation transition and exposes it as a
 * headless effect after the write succeeds. WhatsApp keeps the same business
 * update while the headless observer remains inactive.
 */
export async function updateConversationStateForRoute(
  input: RouteInboundMessageInput,
  update: Omit<ConversationStateUpdate, "env" | "schemaName" | "conversationId">,
): Promise<Awaited<ReturnType<typeof updateConversationState>> | undefined> {
  let conversation: Awaited<ReturnType<typeof updateConversationState>>;
  try {
    conversation = await updateConversationState({
      env: input.env,
      schemaName: input.tenant.schemaName,
      conversationId: input.conversation.id,
      ...update,
    });
  } catch {
    return undefined;
  }
  await recordHeadlessEffect(input, { type: "conversation_mutation", id: conversation.id, status: "updated" });
  return conversation;
}

/**
 * Records a durable business boundary for headless fault-injection tests.
 * Production transports keep the hook unset; WhatsApp never records these
 * headless-only effects.
 */
export async function recordHeadlessEffect(
  input: RouteInboundMessageInput,
  effect: Omit<NormalizedChatEffect, "sequence"> & { status: HeadlessEffectRecord["status"] },
): Promise<void> {
  if (input.source !== "headless") return;
  // The durable execution manifest currently accepts message UUIDs only;
  // business mutations remain observable in the typed effect record but are
  // proven by postcondition fingerprints rather than inserted as message IDs.
  if (effect.type === "outbound_message") input.headlessEffectIds?.push(effect.id);
  input.headlessEffects?.push({ type: effect.type, id: effect.id, status: effect.status });
  await input.afterEffect?.({
    type: effect.type,
    id: effect.id,
    sequence: (input.headlessEffectIds?.length ?? input.headlessEffects?.length ?? 0),
  });
}
