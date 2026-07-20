export interface ServerConfig {
  allowedDirs: string[];
  maxFileSizeBytes: number;
  enableCommands: boolean;
  enableDelete: boolean;
  commandTimeoutMs: number;
  elicitationTimeoutMs: number;
  maxSearchResults: number;
  dataDir: string;
  blockedPathPatterns: string[];
}

export type PermissionDecision =
  | "approved"
  | "always-allow"
  | "declined"
  | "cancelled"
  | "denied-no-elicitation"
  | "denied-timeout"
  | "denied-blocked-path";

export interface BackgroundProcess {
  pid: number;
  command: string;
  cwd: string;
  startedAt: string;
  status: "running" | "exited" | "killed";
  exitCode?: number | null;
}

export interface AuditLogEntry {
  timestamp: string;
  clientName: string;
  clientVersion: string;
  tool: string;
  decision: PermissionDecision;
  details: Record<string, string>;
}

export interface AlwaysAllowRule {
  tool: string;
  pattern: string;
  addedAt: string;
}

export interface AlwaysAllowStoreShape {
  rules: AlwaysAllowRule[];
}
