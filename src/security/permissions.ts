import type { AlwaysAllowStore } from "./always-allow.js";
import type { AuditLogger } from "../utils/logger.js";

/**
 * Minimal shape of the pieces of the MCP SDK's low-level Server that this
 * class needs. Kept as an interface (rather than importing the concrete
 * SDK class here) so this file stays easy to unit test in isolation.
 *
 * Real usage in server.ts:
 *   mcpServer.server.getClientCapabilities()  -> { elicitation?: {}, ... } | undefined
 *   mcpServer.server.elicitInput(params)      -> Promise<ElicitResult>
 */
export interface ElicitationCapableServer {
  getClientCapabilities(): { elicitation?: Record<string, unknown> } | undefined;
  elicitInput(params: {
    message: string;
    requestedSchema: Record<string, unknown>;
  }): Promise<{
    action: "accept" | "decline" | "cancel";
    content?: Record<string, unknown>;
  }>;
}

export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

export class PermissionManager {
  private alwaysAllow: AlwaysAllowStore;
  private logger: AuditLogger;
  private elicitationTimeoutMs: number;

  constructor(
    alwaysAllow: AlwaysAllowStore,
    logger: AuditLogger,
    elicitationTimeoutMs: number
  ) {
    this.alwaysAllow = alwaysAllow;
    this.logger = logger;
    this.elicitationTimeoutMs = elicitationTimeoutMs;
  }

  /**
   * Requests approval for a dangerous operation.
   *
   * Fix #1: capability check reads the CLIENT's declared capabilities
   * (via server.getClientCapabilities().elicitation), never a server-side
   * declaration — the server never advertises "elicitation" as its own
   * capability, because that capability belongs to the client.
   *
   * Fix #2: the elicitation call is raced against a bounded timeout so an
   * ignored/unanswered popup resolves to "denied" instead of hanging this
   * tool call (and the client's wait on it) forever.
   *
   * Returns true if the action is approved, throws PermissionDeniedError
   * otherwise (callers should let this propagate — the MCP SDK will
   * surface it as a tool error).
   */
  async requestPermission(
    lowLevelServer: ElicitationCapableServer,
    toolName: string,
    description: string,
    details: Record<string, string>
  ): Promise<true> {
    // 1. Always-allow rules first — no prompt needed.
    if (this.alwaysAllow.isAllowed(toolName, details)) {
      this.logger.log("always-allow", toolName, details);
      return true;
    }

    // 2. Gate on the CLIENT's declared capability — set once via the
    //    initialize handshake, read here, never declared by the server.
    const clientCaps = lowLevelServer.getClientCapabilities();
    if (!clientCaps?.elicitation) {
      this.logger.log("denied-no-elicitation", toolName, details);
      throw new PermissionDeniedError(
        `Permission denied: "${toolName}" requires interactive approval, but the ` +
          `connected MCP client does not support elicitation. Use a client that ` +
          `supports interactive approval (e.g. Claude Desktop) to run this tool.`
      );
    }

    // 3. Send the elicitation request, raced against a timeout.
    const elicitationPromise = lowLevelServer.elicitInput({
      message: `Permission required: ${description}`,
      requestedSchema: {
        type: "object",
        properties: {
          approve: {
            type: "boolean",
            title: `Allow "${toolName}"?`,
            description: Object.entries(details)
              .map(([k, v]) => `${k}: ${v}`)
              .join("\n"),
            default: false,
          },
          always_allow: {
            type: "boolean",
            title: "Always allow this exact action in future?",
            description:
              "If checked, this specific action will be auto-approved without prompting next time.",
            default: false,
          },
        },
        required: ["approve"],
      },
    });

    const timeoutPromise = new Promise<{ action: "timeout" }>((resolve) => {
      setTimeout(() => resolve({ action: "timeout" }), this.elicitationTimeoutMs);
    });

    const result = await Promise.race([elicitationPromise, timeoutPromise]);

    // 4. Process the response.
    if (result.action === "timeout") {
      this.logger.log("denied-timeout", toolName, details);
      throw new PermissionDeniedError(
        `Permission request for "${toolName}" timed out after ` +
          `${Math.round(this.elicitationTimeoutMs / 1000)}s without a response. Action denied.`
      );
    }

    if (result.action === "accept" && result.content?.approve === true) {
      if (result.content?.always_allow === true) {
        this.alwaysAllow.addRule(toolName, details);
      }
      this.logger.log("approved", toolName, details);
      return true;
    }

    const decision = result.action === "decline" ? "declined" : "cancelled";
    this.logger.log(decision, toolName, details);
    throw new PermissionDeniedError(
      `Permission for "${toolName}" was ${decision === "declined" ? "declined" : "cancelled"} by the user.`
    );
  }
}
