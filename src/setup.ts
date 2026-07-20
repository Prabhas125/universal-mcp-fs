#!/usr/bin/env node
/**
 * universal-mcp-fs setup CLI
 *
 * Automatically configures Claude Desktop to use the universal-mcp-fs
 * MCP server. Detects the correct config file path on all platforms,
 * including the sandboxed path used by Windows Store (UWP) installs.
 *
 * Usage:
 *   universal-mcp-fs-setup [options]
 *   npx universal-mcp-fs setup   (if not installed globally)
 *
 * Options:
 *   --allowed-dirs <dirs>   Semicolon-separated directories (default: home dir)
 *   --uninstall             Remove the filesystem entry from Claude config
 *   --help                  Show this help
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ---- Config path detection ----

interface ConfigLocation {
  path: string;
  label: string;
}

function findClaudeConfigPaths(): ConfigLocation[] {
  const candidates: ConfigLocation[] = [];
  const platform = process.platform;

  if (platform === "win32") {
    // 1. Standard Windows path
    const appData = process.env.APPDATA;
    if (appData) {
      candidates.push({
        path: path.join(appData, "Claude", "claude_desktop_config.json"),
        label: "Windows (standard)",
      });
    }

    // 2. Windows Store (UWP) sandboxed path — scan for Claude_* packages
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const packagesDir = path.join(localAppData, "Packages");
      try {
        const entries = fs.readdirSync(packagesDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name.startsWith("Claude_")) {
            candidates.push({
              path: path.join(
                packagesDir,
                entry.name,
                "LocalCache",
                "Roaming",
                "Claude",
                "claude_desktop_config.json"
              ),
              label: `Windows Store (UWP) — ${entry.name}`,
            });
          }
        }
      } catch {
        // Packages dir doesn't exist or isn't readable — skip
      }
    }
  } else if (platform === "darwin") {
    candidates.push({
      path: path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "Claude",
        "claude_desktop_config.json"
      ),
      label: "macOS",
    });
  } else {
    // Linux and other Unix-likes
    candidates.push({
      path: path.join(
        os.homedir(),
        ".config",
        "Claude",
        "claude_desktop_config.json"
      ),
      label: "Linux",
    });
  }

  return candidates;
}

/**
 * Pick the best config path:
 *  - If only one candidate exists on disk, use that.
 *  - If multiple exist, prefer the UWP path (since the standard path
 *    is often stale/ignored when Claude is installed from the Store).
 *  - If none exist on disk, use the standard path (we'll create it).
 */
function resolveConfigPath(): ConfigLocation {
  const candidates = findClaudeConfigPaths();
  const existing = candidates.filter((c) => fs.existsSync(c.path));

  if (existing.length === 1) return existing[0];

  // Prefer UWP if it exists (the standard path is ignored by Store installs)
  const uwp = existing.find((c) => c.label.includes("UWP"));
  if (uwp) return uwp;

  // If none exist, pick the first (standard) path — we'll create it
  if (existing.length === 0) return candidates[0];

  return existing[0];
}

// ---- Config manipulation ----

interface ClaudeConfig {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

function readConfig(configPath: string): ClaudeConfig {
  if (!fs.existsSync(configPath)) return {};
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as ClaudeConfig;
  } catch {
    return {};
  }
}

function writeConfig(configPath: string, config: ClaudeConfig): void {
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

function backupConfig(configPath: string): string | null {
  if (!fs.existsSync(configPath)) return null;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = configPath + `.backup-${timestamp}`;
  fs.copyFileSync(configPath, backupPath);
  return backupPath;
}

// ---- CLI ----

function printHelp(): void {
  console.log(`
universal-mcp-fs-setup — configure Claude Desktop to use universal-mcp-fs

Usage:
  universal-mcp-fs-setup [options]

Options:
  --allowed-dirs <dirs>   Semicolon-separated list of directories the server
                          may access (default: your home directory)
  --uninstall             Remove the universal-mcp-fs entry from Claude config
  --help                  Show this help

Example:
  universal-mcp-fs-setup
  universal-mcp-fs-setup --allowed-dirs "/home/user/projects;/tmp"
  universal-mcp-fs-setup --uninstall

What this does:
  1. Finds your Claude Desktop config file (handles Windows Store/UWP paths)
  2. Backs up the existing config
  3. Adds (or removes) the "filesystem" MCP server entry
  4. You restart Claude Desktop and the 17 tools are available
`);
}

function parseArgs(argv: string[]): {
  help: boolean;
  uninstall: boolean;
  allowedDirs: string;
} {
  let help = false;
  let uninstall = false;
  let allowedDirs = os.homedir();

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help") help = true;
    else if (argv[i] === "--uninstall") uninstall = true;
    else if (argv[i] === "--allowed-dirs" && argv[i + 1]) {
      allowedDirs = argv[++i];
    }
  }

  return { help, uninstall, allowedDirs };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  // Resolve config location
  const location = resolveConfigPath();
  console.log(`\n📍 Claude Desktop config location: ${location.label}`);
  console.log(`   ${location.path}\n`);

  // Backup
  const backupPath = backupConfig(location.path);
  if (backupPath) {
    console.log(`💾 Backup created: ${backupPath}`);
  }

  // Read current config
  const config = readConfig(location.path);

  if (args.uninstall) {
    // Remove the entry
    if (config.mcpServers && typeof config.mcpServers === "object") {
      const servers = config.mcpServers as Record<string, unknown>;
      if ("filesystem" in servers) {
        delete servers.filesystem;
        writeConfig(location.path, config);
        console.log(`✅ Removed "filesystem" MCP server entry.`);
        console.log(`   Restart Claude Desktop for the change to take effect.\n`);
      } else {
        console.log(`ℹ️  No "filesystem" entry found — nothing to remove.\n`);
      }
    } else {
      console.log(`ℹ️  No mcpServers configured — nothing to remove.\n`);
    }
    return;
  }

  // Add/update the entry
  if (!config.mcpServers || typeof config.mcpServers !== "object") {
    config.mcpServers = {};
  }

  const servers = config.mcpServers as Record<string, unknown>;
  const alreadyExists = "filesystem" in servers;

  servers.filesystem = {
    command: "universal-mcp-fs",
    args: ["--allowed-dirs", args.allowedDirs],
  };

  writeConfig(location.path, config);

  if (alreadyExists) {
    console.log(`🔄 Updated "filesystem" MCP server entry.`);
  } else {
    console.log(`✅ Added "filesystem" MCP server entry.`);
  }

  console.log(`   Command: universal-mcp-fs`);
  console.log(`   Allowed dirs: ${args.allowedDirs}`);
  console.log(``);
  console.log(`👉 Next steps:`);
  console.log(`   1. Fully quit Claude Desktop (don't just close the window)`);
  console.log(`   2. Reopen Claude Desktop`);
  console.log(`   3. Start a new conversation and ask Claude to list files\n`);
  console.log(`   If Claude says it has no matching tool, double-check:`);
  console.log(`   • The config path above is correct for your Claude install`);
  console.log(`   • "universal-mcp-fs" is on your system PATH (run: universal-mcp-fs --version)`);
  console.log(`   • You fully quit and reopened Claude Desktop (not just reload)\n`);
}

main();
