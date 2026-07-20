import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerConfig } from "./types/index.js";
import { registerFilesystemTools } from "./tools/filesystem.js";
import { registerSearchTools } from "./tools/search.js";
import { registerCommandTools } from "./tools/command.js";
import { registerInfoTools } from "./tools/info.js";
import { PermissionManager, type ElicitationCapableServer } from "./security/permissions.js";
import { AlwaysAllowStore } from "./security/always-allow.js";
import { AuditLogger } from "./utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readPackageVersion(): string {
  try {
    const pkgPath = path.join(__dirname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

export interface CreatedServer {
  mcpServer: McpServer;
  logger: AuditLogger;
  /** Call once after mcpServer.connect(transport) resolves, to wire up client-info logging. */
  onInitialized: () => void;
}

/**
 * Creates the MCP server and registers all tools.
 *
 * IMPORTANT (Fix #1): the server's own `capabilities` block declares only
 * what the SERVER provides (tools). It does NOT declare "elicitation" —
 * elicitation is a capability the CLIENT declares during initialize, and
 * this server reads that via `mcpServer.server.getClientCapabilities()`
 * inside PermissionManager at call time, not something advertised here.
 */
export function createServer(config: ServerConfig): CreatedServer {
  const version = readPackageVersion();

  const mcpServer = new McpServer({
    name: "universal-mcp-fs",
    version,
  });
  // NOTE: McpServer's constructor manages its own capability negotiation
  // for tools/resources/prompts based on what you register — there is no
  // "elicitation" key to add here. Elicitation calls are made via
  // mcpServer.server.elicitInput(...) and gated on the CLIENT's declared
  // capability, read from mcpServer.server.getClientCapabilities().

  const logger = new AuditLogger(config.dataDir);
  const alwaysAllow = new AlwaysAllowStore(config.dataDir);
  const permissions = new PermissionManager(alwaysAllow, logger, config.elicitationTimeoutMs);

  // The low-level Server instance (mcpServer.server) is what exposes
  // getClientCapabilities() and elicitInput(). Tools receive a getter
  // function rather than a snapshot, since the client info/capabilities
  // are only populated AFTER connect() resolves and the initialize
  // handshake completes — tool registration happens before that.
  const getLowLevelServer = (): ElicitationCapableServer =>
    mcpServer.server as unknown as ElicitationCapableServer;

  registerFilesystemTools(mcpServer, config, permissions, getLowLevelServer);
  registerSearchTools(mcpServer, config);
  registerCommandTools(mcpServer, config, permissions, getLowLevelServer);
  registerInfoTools(mcpServer, config);

  const onInitialized = (): void => {
    const clientInfo = (mcpServer.server as unknown as {
      getClientVersion?: () => { name: string; version: string } | undefined;
    }).getClientVersion?.();
    logger.setClientInfo(clientInfo?.name ?? "unknown-client", clientInfo?.version ?? "0.0.0");

    const caps = (mcpServer.server as unknown as {
      getClientCapabilities?: () => { elicitation?: unknown } | undefined;
    }).getClientCapabilities?.();
    logger.info(
      `Client connected: ${clientInfo?.name ?? "unknown"} v${clientInfo?.version ?? "?"}. ` +
        `Elicitation support: ${caps?.elicitation ? "yes" : "no"}.`
    );
  };

  return { mcpServer, logger, onInitialized };
}
