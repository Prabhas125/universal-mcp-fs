import os from "node:os";
import path from "node:path";

export interface ShellConfig {
  cmd: string;
  args: string[];
}

/** Returns the platform-appropriate shell invocation prefix. */
export function getShell(): ShellConfig {
  if (isWindows()) {
    return { cmd: "cmd.exe", args: ["/c"] };
  }
  return { cmd: "/bin/bash", args: ["-c"] };
}

export function getHomeDir(): string {
  return os.homedir();
}

export function isWindows(): boolean {
  return process.platform === "win32";
}

/** Default allowed directory set: just the user's home, unless overridden via config. */
export function getDefaultAllowedDirs(): string[] {
  return [os.homedir()];
}

/** Directory where audit logs and the always-allow store live. */
export function getDataDir(): string {
  return path.join(os.homedir(), ".universal-mcp-fs");
}

/** Normalize path separators for consistent display/logging across platforms. */
export function normalizeDisplayPath(p: string): string {
  return p.split(path.sep).join("/");
}
