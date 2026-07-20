import fs from "node:fs/promises";
import os from "node:os";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerConfig } from "../types/index.js";
import { validatePath } from "../security/path-validator.js";
import { normalizeDisplayPath } from "../utils/platform.js";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function registerInfoTools(server: McpServer, config: ServerConfig): void {
  // ---- file_info ----
  server.registerTool(
    "file_info",
    {
      title: "Get File Info",
      description: `Get metadata about a file or directory: size, created/modified dates, permissions, and type.

Args:
  - path (string): Path to inspect.

Returns: size in bytes, created/modified timestamps, POSIX permission bits, and whether it's a directory or symlink.`,
      inputSchema: { path: z.string().describe("Path to inspect") },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ path: rawPath }) => {
      try {
        const validated = validatePath(rawPath, config.allowedDirs, config.blockedPathPatterns);
        const stat = await fs.lstat(validated);
        const info = {
          path: normalizeDisplayPath(validated),
          size_bytes: stat.size,
          created: stat.birthtime.toISOString(),
          modified: stat.mtime.toISOString(),
          permissions: (stat.mode & 0o777).toString(8),
          is_directory: stat.isDirectory(),
          is_symlink: stat.isSymbolicLink(),
          is_file: stat.isFile(),
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(info, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${errorMessage(err)}` }], isError: true };
      }
    }
  );

  // ---- system_info ----
  server.registerTool(
    "system_info",
    {
      title: "Get System Info",
      description: `Get information about the machine this server is running on: OS, hostname, home directory, Node version, CPU count, and total memory.

Returns: a JSON object with platform details.`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const info = {
        platform: os.platform(),
        type: os.type(),
        release: os.release(),
        hostname: os.hostname(),
        home_dir: normalizeDisplayPath(os.homedir()),
        node_version: process.version,
        cpu_count: os.cpus().length,
        total_memory_bytes: os.totalmem(),
        free_memory_bytes: os.freemem(),
        allowed_dirs: config.allowedDirs.map(normalizeDisplayPath),
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(info, null, 2) }] };
    }
  );
}
