import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerConfig } from "../types/index.js";
import { getDefaultAllowedDirs, getDataDir } from "./platform.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface DefaultsFile {
  maxFileSizeBytes: number;
  enableCommands: boolean;
  enableDelete: boolean;
  commandTimeoutMs: number;
  elicitationTimeoutMs: number;
  maxSearchResults: number;
  blockedPathPatterns: string[];
}

function loadDefaultsFile(): DefaultsFile {
  // config/default.json sits alongside dist/ after build (see package.json "files").
  const candidates = [
    path.join(__dirname, "..", "..", "config", "default.json"),
    path.join(__dirname, "..", "config", "default.json"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return JSON.parse(fs.readFileSync(candidate, "utf-8")) as DefaultsFile;
    }
  }
  // Hard-coded fallback if the bundled config file is ever missing.
  return {
    maxFileSizeBytes: 10 * 1024 * 1024,
    enableCommands: true,
    enableDelete: true,
    commandTimeoutMs: 30_000,
    elicitationTimeoutMs: 120_000,
    maxSearchResults: 50,
    blockedPathPatterns: [],
  };
}

function parseCliArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = "true";
      }
    }
  }
  return args;
}

export function loadConfig(argv: string[] = process.argv.slice(2)): ServerConfig {
  const cliArgs = parseCliArgs(argv);
  const defaults = loadDefaultsFile();

  const allowedDirsRaw =
    cliArgs["allowed-dirs"] ??
    process.env.MCP_ALLOWED_DIRS ??
    getDefaultAllowedDirs().join(path.delimiter);

  const allowedDirs = allowedDirsRaw
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => path.resolve(d));

  const enableCommands =
    cliArgs["disable-commands"] !== undefined ||
    process.env.MCP_DISABLE_COMMANDS === "true"
      ? false
      : defaults.enableCommands;

  const enableDelete =
    cliArgs["disable-delete"] !== undefined ||
    process.env.MCP_DISABLE_DELETE === "true"
      ? false
      : defaults.enableDelete;

  return {
    allowedDirs: allowedDirs.length > 0 ? allowedDirs : getDefaultAllowedDirs(),
    maxFileSizeBytes: Number(
      cliArgs["max-file-size"] ?? process.env.MCP_MAX_FILE_SIZE ?? defaults.maxFileSizeBytes
    ),
    enableCommands,
    enableDelete,
    commandTimeoutMs: Number(
      cliArgs["command-timeout"] ?? process.env.MCP_COMMAND_TIMEOUT_MS ?? defaults.commandTimeoutMs
    ),
    elicitationTimeoutMs: Number(
      cliArgs["elicitation-timeout"] ??
        process.env.MCP_ELICITATION_TIMEOUT_MS ??
        defaults.elicitationTimeoutMs
    ),
    maxSearchResults: Number(
      cliArgs["max-search-results"] ??
        process.env.MCP_MAX_SEARCH_RESULTS ??
        defaults.maxSearchResults
    ),
    dataDir: process.env.MCP_DATA_DIR ?? getDataDir(),
    blockedPathPatterns: defaults.blockedPathPatterns,
  };
}
