import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { glob } from "glob";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerConfig } from "../types/index.js";
import { validatePath } from "../security/path-validator.js";
import { normalizeDisplayPath } from "../utils/platform.js";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function registerSearchTools(server: McpServer, config: ServerConfig): void {
  // ---- search_files ----
  server.registerTool(
    "search_files",
    {
      title: "Search Files by Name",
      description: `Find files matching a glob pattern within a directory (e.g. "**/*.ts", "*.log").

Args:
  - directory (string): Base directory to search within.
  - pattern (string): Glob pattern to match filenames against.
  - max_results (number, optional): Cap on returned results. Default: ${50}.

Returns: a list of matching file paths, relative to the search directory.`,
      inputSchema: {
        directory: z.string().describe("Base directory to search within"),
        pattern: z.string().describe('Glob pattern, e.g. "**/*.ts"'),
        max_results: z.number().int().min(1).max(500).optional().describe("Maximum results to return"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ directory, pattern, max_results }) => {
      try {
        const validated = validatePath(directory, config.allowedDirs, config.blockedPathPatterns);
        const limit = max_results ?? config.maxSearchResults;
        const matches = await glob(pattern, { cwd: validated, nodir: false, dot: false });
        const limited = matches.slice(0, limit);
        if (limited.length === 0) {
          return { content: [{ type: "text" as const, text: `No files matched pattern "${pattern}" in ${normalizeDisplayPath(validated)}` }] };
        }
        const suffix = matches.length > limit ? `\n... (${matches.length - limit} more results truncated)` : "";
        return { content: [{ type: "text" as const, text: limited.join("\n") + suffix }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${errorMessage(err)}` }], isError: true };
      }
    }
  );

  // ---- search_content ----
  server.registerTool(
    "search_content",
    {
      title: "Search File Contents",
      description: `Grep-like search: find a text query across files in a directory, returning matching lines with 2 lines of context before/after.

Args:
  - directory (string): Base directory to search within.
  - query (string): Text to search for (case-sensitive, literal substring match).
  - file_pattern (string, optional): Glob to limit which files are searched (e.g. "**/*.js"). Default: all files.
  - max_results (number, optional): Cap on returned matches. Default: ${50}.

Returns: matching lines with file path, line number, and surrounding context.`,
      inputSchema: {
        directory: z.string().describe("Base directory to search within"),
        query: z.string().min(1).describe("Text to search for (literal substring, case-sensitive)"),
        file_pattern: z.string().optional().describe('Glob to limit searched files, e.g. "**/*.js"'),
        max_results: z.number().int().min(1).max(500).optional().describe("Maximum matches to return"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ directory, query, file_pattern, max_results }) => {
      try {
        const validated = validatePath(directory, config.allowedDirs, config.blockedPathPatterns);
        const limit = max_results ?? config.maxSearchResults;
        const pattern = file_pattern ?? "**/*";
        const files = await glob(pattern, { cwd: validated, nodir: true, dot: false });

        const results: string[] = [];
        outer: for (const relFile of files) {
          const fullPath = path.join(validated, relFile);
          let content: string;
          try {
            content = await fs.readFile(fullPath, "utf-8");
          } catch {
            continue; // skip unreadable/binary files
          }
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(query)) {
              const start = Math.max(0, i - 2);
              const end = Math.min(lines.length - 1, i + 2);
              const contextBlock = lines
                .slice(start, end + 1)
                .map((l, idx) => `${start + idx + 1}${start + idx === i ? " >" : "  "} ${l}`)
                .join("\n");
              results.push(`--- ${relFile} ---\n${contextBlock}`);
              if (results.length >= limit) break outer;
            }
          }
        }

        if (results.length === 0) {
          return { content: [{ type: "text" as const, text: `No matches for "${query}" in ${normalizeDisplayPath(validated)}` }] };
        }
        return { content: [{ type: "text" as const, text: results.join("\n\n") }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${errorMessage(err)}` }], isError: true };
      }
    }
  );
}
