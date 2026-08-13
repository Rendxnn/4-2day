export type HeadlessCommand =
  | { version: 1; command: "start"; tenant: string; identityId?: string }
  | { version: 1; command: "turn"; tenant: string; sessionId: string; turnId: string; text: string }
  | { version: 1; command: "inspect"; tenant: string; sessionId: string }
  | { version: 1; command: "reconcile"; tenant: string; sessionId: string; turnId: string; observedOutcome: "effects_applied" | "no_effects" }
  | { version: 1; command: "close"; tenant: string; sessionId: string };

export function parseHeadlessCommand(value: unknown): HeadlessCommand {
  if (!value || typeof value !== "object") throw new Error("INVALID_COMMAND");
  const command = value as Record<string, unknown>;
  const allowedKeys = command.command === "start"
    ? ["version", "command", "tenant", "identityId"]
    : command.command === "turn"
      ? ["version", "command", "tenant", "sessionId", "turnId", "text"]
      : command.command === "reconcile"
        ? ["version", "command", "tenant", "sessionId", "turnId", "observedOutcome"]
        : ["version", "command", "tenant", "sessionId"];
  if (Object.keys(command).some((key) => !allowedKeys.includes(key))) throw new Error("INVALID_COMMAND");
  if (command.version !== 1 || typeof command.command !== "string" || typeof command.tenant !== "string") {
    throw new Error(command.version !== 1 ? "UNSUPPORTED_VERSION" : "INVALID_COMMAND");
  }
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(command.tenant)) throw new Error("INVALID_COMMAND");

  if (command.command === "start") {
    if (command.identityId !== undefined && !isOpaque(command.identityId, "hid_")) throw new Error("INVALID_COMMAND");
    return command as unknown as HeadlessCommand;
  }
  if (command.command === "turn") {
    if (!isOpaque(command.sessionId, "hss_") || !isTurnId(command.turnId) || typeof command.text !== "string") {
      throw new Error("INVALID_COMMAND");
    }
    if (command.text.length < 1 || command.text.length > 4096) throw new Error("TEXT_TOO_LONG");
    return command as unknown as HeadlessCommand;
  }
  if (command.command === "inspect" || command.command === "close") {
    if (!isOpaque(command.sessionId, "hss_")) throw new Error("INVALID_COMMAND");
    return command as unknown as HeadlessCommand;
  }
  if (command.command === "reconcile") {
    if (!isOpaque(command.sessionId, "hss_") || !isTurnId(command.turnId)) throw new Error("INVALID_COMMAND");
    if (command.observedOutcome !== "effects_applied" && command.observedOutcome !== "no_effects") throw new Error("INVALID_COMMAND");
    return command as unknown as HeadlessCommand;
  }
  throw new Error("INVALID_COMMAND");
}

function isOpaque(value: unknown, prefix: string): value is string {
  return typeof value === "string" && value.startsWith(prefix) && value.length >= prefix.length + 6 && /^[A-Za-z0-9_-]+$/.test(value.slice(prefix.length));
}

function isTurnId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 96 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}
