import fs from "node:fs";
import path from "node:path";
import type { AlwaysAllowRule, AlwaysAllowStoreShape } from "../types/index.js";

/**
 * Persists "always allow" grants to ~/.universal-mcp-fs/always-allow.json
 * so they survive the Claude Desktop kill/respawn cycle between sessions.
 *
 * A rule matches on (tool name, exact detail-string pattern). Patterns are
 * simple exact-match strings built from the tool's key identifying detail
 * (e.g. the literal command for run_command) — kept intentionally simple
 * and auditable rather than doing fuzzy/glob matching on shell commands,
 * which would be a security footgun.
 */
export class AlwaysAllowStore {
  private filePath: string;
  private rules: AlwaysAllowRule[] = [];

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "always-allow.json");
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(raw) as AlwaysAllowStoreShape;
        this.rules = Array.isArray(parsed.rules) ? parsed.rules : [];
      }
    } catch {
      // Corrupt or unreadable store — start fresh rather than crashing startup.
      this.rules = [];
    }
  }

  private persist(): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const data: AlwaysAllowStoreShape = { rules: this.rules };
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  private buildPattern(toolName: string, details: Record<string, string>): string {
    // Use the most identifying detail field for the pattern. For
    // run_command that's the command string; for file tools it's the path.
    const key = details.command ?? details.path ?? details.pid ?? JSON.stringify(details);
    return `${toolName}::${key}`;
  }

  isAllowed(toolName: string, details: Record<string, string>): boolean {
    const pattern = this.buildPattern(toolName, details);
    return this.rules.some((r) => r.tool === toolName && r.pattern === pattern);
  }

  addRule(toolName: string, details: Record<string, string>): void {
    const pattern = this.buildPattern(toolName, details);
    if (this.isAllowed(toolName, details)) return;
    this.rules.push({ tool: toolName, pattern, addedAt: new Date().toISOString() });
    this.persist();
  }

  listRules(): AlwaysAllowRule[] {
    return [...this.rules];
  }

  clearAll(): void {
    this.rules = [];
    this.persist();
  }
}
