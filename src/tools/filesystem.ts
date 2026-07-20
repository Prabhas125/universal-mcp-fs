import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerConfig } from "../types/index.js";
import { validatePath, BlockedPathError, PathOutsideAllowedDirsError } from "../security/path-validator.js";
import type { PermissionManager, ElicitationCapableServer } from "../security/permissions.js";
import { normalizeDisplayPath } from "../utils/platform.js";

function isBinary(buffer: Buffer): boolean {
  const sampleLen = Math.min(buffer.length, 8000);
  for (let i = 0; i < sampleLen; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

function errorMessage(err: unknown): string {
  if (err instanceof BlockedPathError || err instanceof PathOutsideAllowedDirsError) {
    return err.message;
  }
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return "File or directory not found.";
    if (code === "EACCES") return "Permission denied by the operating system (not by this server's approval system).";
    if (code === "EISDIR") return "Expected a file but found a directory.";
    if (code === "ENOTDIR") return "Expected a directory but found a file.";
  }
  return err instanceof Error ? err.message : String(err);
}

export function registerFilesystemTools(
  server: McpServer,
  config: ServerConfig,
  permissions: PermissionManager,
  getLowLevelServer: () => ElicitationCapableServer
): void {
  // ---- read_file ----
  server.registerTool(
    "read_file",
    {
      title: "Read File",
      description: `Read the full contents of a file. Text files are returned as UTF-8 text; binary files are detected automatically and returned as base64.

Args:
  - path (string): Absolute or relative path to the file.

Returns: file contents as text, or a note that the file is binary with base64 content.

Error Handling:
  - Returns an error if the path is outside allowed directories or matches a blocked pattern (e.g. .ssh, .aws).
  - Returns "File or directory not found" if the path does not exist.`,
      inputSchema: { path: z.string().describe("Path to the file to read") },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ path: rawPath }) => {
      try {
        const validated = validatePath(rawPath, config.allowedDirs, config.blockedPathPatterns);
        const stat = await fs.stat(validated);
        if (stat.size > config.maxFileSizeBytes) {
          return {
            content: [{
              type: "text" as const,
              text: `Error: file is ${stat.size} bytes, exceeding the ${config.maxFileSizeBytes} byte limit. Use read_file_lines to read a portion instead.`,
            }],
            isError: true,
          };
        }
        const buffer = await fs.readFile(validated);
        if (isBinary(buffer)) {
          return {
            content: [{
              type: "text" as const,
              text: `[Binary file, ${buffer.length} bytes, base64-encoded]\n${buffer.toString("base64")}`,
            }],
          };
        }
        return { content: [{ type: "text" as const, text: buffer.toString("utf-8") }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${errorMessage(err)}` }], isError: true };
      }
    }
  );

  // ---- read_file_lines ----
  server.registerTool(
    "read_file_lines",
    {
      title: "Read File Lines",
      description: `Read a specific line range from a file. Useful for large files where reading the whole thing would exceed limits.

Args:
  - path (string): Path to the file.
  - start_line (number): 1-indexed starting line (inclusive).
  - end_line (number): 1-indexed ending line (inclusive).

Returns: the requested lines, each prefixed with its line number.`,
      inputSchema: {
        path: z.string().describe("Path to the file"),
        start_line: z.number().int().min(1).describe("1-indexed starting line, inclusive"),
        end_line: z.number().int().min(1).describe("1-indexed ending line, inclusive"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ path: rawPath, start_line, end_line }) => {
      try {
        const validated = validatePath(rawPath, config.allowedDirs, config.blockedPathPatterns);
        const content = await fs.readFile(validated, "utf-8");
        const lines = content.split("\n");
        if (start_line > end_line) {
          return { content: [{ type: "text" as const, text: "Error: start_line must be <= end_line." }], isError: true };
        }
        const slice = lines.slice(start_line - 1, end_line);
        const numbered = slice.map((line, idx) => `${start_line + idx}: ${line}`).join("\n");
        return {
          content: [{
            type: "text" as const,
            text: numbered.length > 0 ? numbered : `(no content in range; file has ${lines.length} lines)`,
          }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${errorMessage(err)}` }], isError: true };
      }
    }
  );

  // ---- write_file ----
  server.registerTool(
    "write_file",
    {
      title: "Write File",
      description: `Create a new file or overwrite an existing one. Parent directories are created automatically.

Overwriting an EXISTING file requires interactive user approval (elicitation) — the server will pause and ask the connected client to confirm before proceeding.

Args:
  - path (string): Path to write to.
  - content (string): Text content to write (UTF-8).
  - overwrite (boolean, optional): Must be true to overwrite an existing file. Default: false.

Error Handling:
  - Returns an error without writing if the file exists and overwrite is not true.
  - Returns an error if the user declines the overwrite approval prompt.`,
      inputSchema: {
        path: z.string().describe("Path to write to"),
        content: z.string().describe("Text content to write"),
        overwrite: z.boolean().optional().default(false).describe("Set true to allow overwriting an existing file"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ path: rawPath, content, overwrite }) => {
      try {
        const validated = validatePath(rawPath, config.allowedDirs, config.blockedPathPatterns, true);
        const exists = fsSync.existsSync(validated);

        if (exists && !overwrite) {
          return {
            content: [{ type: "text" as const, text: `Error: file already exists at "${normalizeDisplayPath(validated)}". Pass overwrite: true to replace it.` }],
            isError: true,
          };
        }

        if (exists && overwrite) {
          await permissions.requestPermission(
            getLowLevelServer(),
            "write_file",
            `Overwrite existing file: ${normalizeDisplayPath(validated)}`,
            { path: normalizeDisplayPath(validated) }
          );
        }

        await fs.mkdir(path.dirname(validated), { recursive: true });
        await fs.writeFile(validated, content, "utf-8");
        return { content: [{ type: "text" as const, text: `Wrote ${Buffer.byteLength(content, "utf-8")} bytes to ${normalizeDisplayPath(validated)}` }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${errorMessage(err)}` }], isError: true };
      }
    }
  );

  // ---- create_directory ----
  server.registerTool(
    "create_directory",
    {
      title: "Create Directory",
      description: `Create a directory, including any missing parent directories (like mkdir -p).

Args:
  - path (string): Directory path to create.

Returns: confirmation of the created path. No error if the directory already exists.`,
      inputSchema: { path: z.string().describe("Directory path to create") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ path: rawPath }) => {
      try {
        const validated = validatePath(rawPath, config.allowedDirs, config.blockedPathPatterns, true);
        await fs.mkdir(validated, { recursive: true });
        return { content: [{ type: "text" as const, text: `Created directory ${normalizeDisplayPath(validated)}` }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${errorMessage(err)}` }], isError: true };
      }
    }
  );

  // ---- list_directory ----
  server.registerTool(
    "list_directory",
    {
      title: "List Directory",
      description: `List the contents of a directory with metadata (type, size, modified date).

Args:
  - path (string): Directory to list.
  - recursive (boolean, optional): List subdirectories recursively. Default: false.
  - show_hidden (boolean, optional): Include dotfiles/dotdirs. Default: false.

Returns: a listing with one entry per line: type, size, modified date, name.`,
      inputSchema: {
        path: z.string().describe("Directory to list"),
        recursive: z.boolean().optional().default(false).describe("List subdirectories recursively"),
        show_hidden: z.boolean().optional().default(false).describe("Include dotfiles/dotdirs"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ path: rawPath, recursive, show_hidden }) => {
      try {
        const validated = validatePath(rawPath, config.allowedDirs, config.blockedPathPatterns);

        async function walk(dir: string, depth: number): Promise<string[]> {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          const lines: string[] = [];
          for (const entry of entries) {
            if (!show_hidden && entry.name.startsWith(".")) continue;
            const fullPath = path.join(dir, entry.name);
            const stat = await fs.stat(fullPath).catch(() => null);
            const type = entry.isDirectory() ? "dir" : entry.isSymbolicLink() ? "symlink" : "file";
            const size = stat ? stat.size : 0;
            const modified = stat ? stat.mtime.toISOString() : "unknown";
            const indent = "  ".repeat(depth);
            lines.push(`${indent}[${type}] ${entry.name}  (${size} bytes, modified ${modified})`);
            if (recursive && entry.isDirectory()) {
              lines.push(...(await walk(fullPath, depth + 1)));
            }
          }
          return lines;
        }

        const lines = await walk(validated, 0);
        return {
          content: [{
            type: "text" as const,
            text: lines.length > 0 ? lines.join("\n") : "(empty directory)",
          }],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${errorMessage(err)}` }], isError: true };
      }
    }
  );

  // ---- move_file ----
  server.registerTool(
    "move_file",
    {
      title: "Move or Rename File",
      description: `Move or rename a file or directory. ALWAYS requires interactive user approval before proceeding.

Args:
  - source (string): Current path.
  - destination (string): Target path.

Error Handling:
  - Both source and destination are validated against allowed directories and blocked paths.
  - Returns an error if the user declines the approval prompt.`,
      inputSchema: {
        source: z.string().describe("Current path of the file or directory"),
        destination: z.string().describe("Target path to move/rename to"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ source, destination }) => {
      try {
        const validSource = validatePath(source, config.allowedDirs, config.blockedPathPatterns, true);
        const validDest = validatePath(destination, config.allowedDirs, config.blockedPathPatterns, true);

        await permissions.requestPermission(
          getLowLevelServer(),
          "move_file",
          `Move/rename: ${normalizeDisplayPath(validSource)} -> ${normalizeDisplayPath(validDest)}`,
          { source: normalizeDisplayPath(validSource), destination: normalizeDisplayPath(validDest) }
        );

        await fs.mkdir(path.dirname(validDest), { recursive: true });
        await fs.rename(validSource, validDest);
        return { content: [{ type: "text" as const, text: `Moved ${normalizeDisplayPath(validSource)} -> ${normalizeDisplayPath(validDest)}` }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${errorMessage(err)}` }], isError: true };
      }
    }
  );

  // ---- copy_file ----
  server.registerTool(
    "copy_file",
    {
      title: "Copy File or Directory",
      description: `Copy a file or directory (recursively for directories). Does not modify the source, so no approval is required.

Args:
  - source (string): Path to copy from.
  - destination (string): Path to copy to.`,
      inputSchema: {
        source: z.string().describe("Path to copy from"),
        destination: z.string().describe("Path to copy to"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ source, destination }) => {
      try {
        const validSource = validatePath(source, config.allowedDirs, config.blockedPathPatterns);
        const validDest = validatePath(destination, config.allowedDirs, config.blockedPathPatterns, true);
        await fs.mkdir(path.dirname(validDest), { recursive: true });
        await fs.cp(validSource, validDest, { recursive: true });
        return { content: [{ type: "text" as const, text: `Copied ${normalizeDisplayPath(validSource)} -> ${normalizeDisplayPath(validDest)}` }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${errorMessage(err)}` }], isError: true };
      }
    }
  );

  // ---- delete_file ----
  server.registerTool(
    "delete_file",
    {
      title: "Delete File",
      description: `Permanently delete a single file. ALWAYS requires interactive user approval before proceeding — this cannot be undone.

Args:
  - path (string): Path to the file to delete.`,
      inputSchema: { path: z.string().describe("Path to the file to delete") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ path: rawPath }) => {
      try {
        if (!config.enableDelete) {
          return { content: [{ type: "text" as const, text: "Error: delete operations are disabled on this server (enableDelete=false)." }], isError: true };
        }
        const validated = validatePath(rawPath, config.allowedDirs, config.blockedPathPatterns, true);

        await permissions.requestPermission(
          getLowLevelServer(),
          "delete_file",
          `Permanently delete file: ${normalizeDisplayPath(validated)}`,
          { path: normalizeDisplayPath(validated) }
        );

        await fs.unlink(validated);
        return { content: [{ type: "text" as const, text: `Deleted ${normalizeDisplayPath(validated)}` }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${errorMessage(err)}` }], isError: true };
      }
    }
  );

  // ---- delete_directory ----
  server.registerTool(
    "delete_directory",
    {
      title: "Delete Directory",
      description: `Permanently delete a directory and all its contents, recursively. ALWAYS requires interactive user approval before proceeding — this cannot be undone.

Args:
  - path (string): Directory to delete.`,
      inputSchema: { path: z.string().describe("Directory to delete") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ path: rawPath }) => {
      try {
        if (!config.enableDelete) {
          return { content: [{ type: "text" as const, text: "Error: delete operations are disabled on this server (enableDelete=false)." }], isError: true };
        }
        const validated = validatePath(rawPath, config.allowedDirs, config.blockedPathPatterns, true);

        await permissions.requestPermission(
          getLowLevelServer(),
          "delete_directory",
          `Permanently delete directory and all contents: ${normalizeDisplayPath(validated)}`,
          { path: normalizeDisplayPath(validated) }
        );

        await fs.rm(validated, { recursive: true, force: true });
        return { content: [{ type: "text" as const, text: `Deleted directory ${normalizeDisplayPath(validated)}` }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${errorMessage(err)}` }], isError: true };
      }
    }
  );
}
