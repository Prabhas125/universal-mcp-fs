import fs from "node:fs";
import path from "node:path";
import type { AuditLogEntry, PermissionDecision } from "../types/index.js";

export class AuditLogger {
  private logFilePath: string;
  private clientName = "unknown-client";
  private clientVersion = "0.0.0";

  constructor(dataDir: string) {
    this.logFilePath = path.join(dataDir, "audit.log");
    fs.mkdirSync(dataDir, { recursive: true });
  }

  setClientInfo(name: string, version: string): void {
    this.clientName = name;
    this.clientVersion = version;
  }

  log(
    decision: PermissionDecision,
    tool: string,
    details: Record<string, string>
  ): void {
    const entry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      clientName: this.clientName,
      clientVersion: this.clientVersion,
      tool,
      decision,
      details,
    };

    // Always to stderr — visible in Claude Desktop's MCP server logs.
    console.error(
      `[universal-mcp-fs] ${entry.timestamp} client=${entry.clientName} tool=${tool} decision=${decision}`
    );

    // Also append to a persisted audit file.
    try {
      fs.appendFileSync(this.logFilePath, JSON.stringify(entry) + "\n", "utf-8");
    } catch (err) {
      console.error(`[universal-mcp-fs] Failed to write audit log: ${String(err)}`);
    }
  }

  info(message: string): void {
    console.error(`[universal-mcp-fs] ${message}`);
  }
}
