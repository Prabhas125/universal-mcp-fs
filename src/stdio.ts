import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import type { ServerConfig } from "./types/index.js";
import { normalizeDisplayPath } from "./utils/platform.js";

export async function startStdio(config: ServerConfig): Promise<void> {
  const { mcpServer, logger, onInitialized } = createServer(config);
  const transport = new StdioServerTransport();

  // Fires once the initialize handshake completes — this is where we can
  // finally read the connected client's name/version and its declared
  // capabilities (including whether it supports elicitation).
  (mcpServer.server as unknown as { oninitialized?: () => void }).oninitialized = onInitialized;

  logger.info(`Starting. Allowed dirs: ${config.allowedDirs.map(normalizeDisplayPath).join(", ")}`);
  logger.info("17 tools registered. Waiting for client...");

  await mcpServer.connect(transport);
}
