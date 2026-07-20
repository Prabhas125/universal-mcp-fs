# universal-mcp-fs

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

A local MCP (Model Context Protocol) server that gives AI assistants — Claude Desktop, and any other stdio-compatible MCP client — **full filesystem access and command execution** on your machine.

- **stdio only.** No HTTP server, no open ports, no internet exposure.
- **Elicitation-based approval.** Dangerous actions (delete, run commands, move files) pause and ask for a native approval popup before proceeding.
- **Sensitive paths are blocked outright** (`.ssh`, `.aws`, `.gnupg`, browser credential stores, `/etc/shadow`, etc.) — before any approval prompt is even offered.
- **17 tools** covering file read/write/move/copy/delete, directory listing, filename and content search, and shell command execution (foreground and background).

---

## Quick Start (3 commands)

```bash
npm install -g universal-mcp-fs       # 1. Install
universal-mcp-fs-setup                # 2. Auto-configure Claude Desktop
# 3. Restart Claude Desktop — done!
```

That's it. Open a new conversation in Claude Desktop and ask it to list your files.

> **What does `universal-mcp-fs-setup` do?**
> It finds your Claude Desktop config file (auto-detecting Windows Store/UWP sandboxed paths, macOS, and Linux), creates a backup, and adds the MCP server entry. Run `universal-mcp-fs-setup --help` for options.

---

## Alternative: Use with npx (no install)

If you prefer not to install globally, you can configure Claude Desktop to use `npx` directly. Edit your config file and add:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "universal-mcp-fs", "--allowed-dirs", "/home/user"]
    }
  }
}
```

Config file locations:

| OS | Path |
|----|------|
| **Windows** | `%APPDATA%\Claude\claude_desktop_config.json` |
| **Windows (Store/UWP)** | `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude\claude_desktop_config.json` |
| **macOS** | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Linux** | `~/.config/Claude/claude_desktop_config.json` |

> **Windows Store (UWP) users**: If Claude Desktop was installed from the Microsoft Store, your config file is in a sandboxed location. The `universal-mcp-fs-setup` command handles this automatically. If you're editing manually, look for a folder matching `Claude_*` under `%LOCALAPPDATA%\Packages\`.

---

## Install from source

```bash
git clone https://github.com/PRABHAS125/universal-mcp-fs.git
cd universal-mcp-fs
npm install
npm run build
```

Then configure Claude Desktop manually:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "node",
      "args": [
        "/full/path/to/universal-mcp-fs/dist/index.js",
        "--allowed-dirs",
        "/home/user;/home/user/projects"
      ]
    }
  }
}
```

On Windows, use forward slashes or double-escaped backslashes in the path, e.g. `"C:\\Users\\yourname\\projects\\universal-mcp-fs\\dist\\index.js"`.

---

## Verify it's connected

Ask Claude something like *"list the files in my home directory"*. If it responds with a directory listing, the server is connected.

If Claude says it has no matching tool:
1. Double-check the config file path (especially on Windows Store installs)
2. Verify the JSON syntax is valid
3. Make sure you **fully quit and reopened** Claude Desktop (a reload isn't enough — it only reads the config on startup)
4. Run `universal-mcp-fs --version` to confirm it's on your PATH

---

## Configuration options

All options can be passed as CLI args in the config's `args` array, or as environment variables in an `env` block.

| CLI flag | Env var | Default | Description |
|---|---|---|---|
| `--allowed-dirs` | `MCP_ALLOWED_DIRS` | your home directory | Semicolon-separated list of directories the server may access |
| `--disable-commands` | `MCP_DISABLE_COMMANDS=true` | commands enabled | Disables `run_command` / `run_command_background` |
| `--disable-delete` | `MCP_DISABLE_DELETE=true` | delete enabled | Disables `delete_file` / `delete_directory` |
| `--max-file-size` | `MCP_MAX_FILE_SIZE` | 10485760 (10 MB) | Max bytes `read_file` will read in one call |
| `--command-timeout` | `MCP_COMMAND_TIMEOUT_MS` | 30000 | Default timeout for `run_command`, in ms |
| `--elicitation-timeout` | `MCP_ELICITATION_TIMEOUT_MS` | 120000 | How long an approval popup waits before auto-denying, in ms |
| `--max-search-results` | `MCP_MAX_SEARCH_RESULTS` | 50 | Cap on results from search tools |

---

## Tool reference

**Filesystem** — `read_file`, `read_file_lines`, `write_file`, `create_directory`, `list_directory`, `move_file`, `copy_file`, `delete_file`, `delete_directory`

**Search** — `search_files` (by filename/glob), `search_content` (grep-like, with context lines)

**Commands** — `run_command`, `run_command_background`, `list_processes`, `kill_process`

**Info** — `file_info`, `system_info`

Full parameter docs are visible to the AI client automatically (and to you, via `npx @modelcontextprotocol/inspector`).

---

## Permission system

Some tools always require your approval before running: `delete_file`, `delete_directory`, `run_command`, `run_command_background`, `move_file`, `kill_process`, and `write_file` when overwriting an existing file.

When one of these is called, the server sends an **elicitation request** to Claude Desktop, which renders it as a native approval dialog. You can:
- **Approve** — the action runs once
- **Approve + "always allow"** — this exact action is silently approved from then on, persisted to `~/.universal-mcp-fs/always-allow.json`
- **Decline/cancel** — the action is aborted

If you don't respond within 2 minutes, the request automatically resolves to denied.

Sensitive paths (`.ssh`, `.aws`, `.gnupg`, browser credential files, `/etc/shadow`) are rejected before any approval prompt is offered. You can extend this list via `config/default.json` if you build from source.

Every decision is logged to `~/.universal-mcp-fs/audit.log` and to stderr.

---

## Security model

- No network transport — this server never opens a port or listens for external connections.
- All file operations are validated against `--allowed-dirs`; anything outside is rejected regardless of approval.
- Symlinks are resolved before validation, so a symlink inside an allowed directory can't be used to escape it.
- Path traversal (`../..`) is normalized away before any check runs.
- If the connected client doesn't support elicitation, dangerous tools fail closed (denied), never fail open.

---

## Setup command reference

```bash
# Auto-configure Claude Desktop (detects OS and UWP paths)
universal-mcp-fs-setup

# Configure with custom allowed directories
universal-mcp-fs-setup --allowed-dirs "/home/user/projects;/tmp"

# Remove the config entry
universal-mcp-fs-setup --uninstall

# Show help
universal-mcp-fs-setup --help
```

Platform-specific scripts are also available in `scripts/`:
- `scripts/setup-claude.ps1` — PowerShell (Windows, handles UWP)
- `scripts/setup-claude.sh` — Bash (macOS and Linux)

---

## Publishing / contributing

```bash
npm run build
npm version patch     # bumps package.json, creates a git tag
git push && git push --tags
npm publish
```

Issues and PRs welcome.

## License

MIT
