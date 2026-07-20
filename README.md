<div align="center">

<img src="https://img.icons8.com/fluency/96/000000/folder-invoices.png" width="90" alt="universal-mcp-fs logo" />

# universal-mcp-fs

**A secure, local MCP server that gives AI assistants controlled access to your filesystem.**

[![npm version](https://img.shields.io/npm/v/universal-mcp-fs?color=cb3837&logo=npm&label=npm)](https://www.npmjs.com/package/universal-mcp-fs)
[![GitHub](https://img.shields.io/badge/GitHub-Prabhas125%2Funiversal--mcp--fs-181717?logo=github&logoColor=white)](https://github.com/Prabhas125/universal-mcp-fs)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20.0.0-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux-lightgrey?logo=linux&logoColor=white)]()
[![MCP](https://img.shields.io/badge/Protocol-MCP-6E56CF)](https://modelcontextprotocol.io)

<p>
  <img src="https://img.shields.io/badge/Claude_Desktop-D97757?logo=anthropic&logoColor=white" alt="Claude Desktop" />
  <img src="https://img.shields.io/badge/ChatGPT_Desktop-74AA9C?logo=openai&logoColor=white" alt="ChatGPT Desktop" />
  <img src="https://img.shields.io/badge/Perplexity_Desktop-1FB8CD?logo=perplexity&logoColor=white" alt="Perplexity Desktop" />
</p>

</div>

---

### 🛠️ Built With

<p>
  <img src="https://skillicons.dev/icons?i=nodejs,typescript,npm,git,github" alt="tech stack" />
</p>

---

## Overview

`universal-mcp-fs` gives AI assistants — Claude Desktop today, and any other stdio-compatible MCP client as they add support — filesystem access and command execution on your machine, gated behind an interactive approval system.

- **stdio only.** No HTTP server, no open ports, no internet exposure.
- **Elicitation-based approval.** Dangerous actions (delete, run commands, move files) pause and ask the connected client to show a native approval popup — the same kind of Allow/Deny prompt you already see for other tool calls in Claude Desktop.
- **Sensitive paths are blocked outright** (`.ssh`, `.aws`, `.gnupg`, browser credential stores, `/etc/shadow`, etc.) — before any approval prompt is even offered.
- **17 tools** covering file read/write/move/copy/delete, directory listing, filename and content search, and shell command execution (foreground and background).

---

## Install

### Option 1 — npm (recommended, no build step)

```bash
npm install -g universal-mcp-fs
```

### Option 2 — from source (GitHub)

```bash
git clone https://github.com/Prabhas125/universal-mcp-fs.git
cd universal-mcp-fs
npm install
npm run build
```

---

## Setup: Claude Desktop

Edit your Claude Desktop config file:

- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

**If you installed via npm (Option 1):**

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "universal-mcp-fs",
      "args": ["--allowed-dirs", "/home/user;/home/user/projects"]
    }
  }
}
```

**If you built from source (Option 2):**

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

On Windows, use double-escaped backslashes in the path, e.g. `"C:\\Users\\yourname\\projects\\universal-mcp-fs\\dist\\index.js"`.

**Then restart Claude Desktop.** It will spawn the server automatically and the 17 tools will be available in chat. No further setup, no login, no token.

### Verify it's connected

Ask Claude something like *"list the files in [one of your allowed directories]"*. If it responds with a directory listing, the server is connected. If Claude says it has no matching tool, double check the config file path and JSON syntax, then fully quit and reopen Claude Desktop (a reload isn't enough — it only reads this file on startup).

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

When one of these is called, the server sends an **elicitation request** to Claude Desktop, which renders it as a native approval dialog — the same UI you already see for regular tool-call confirmations. You can:
- **Approve** — the action runs once
- **Approve + "always allow"** — this exact action (same tool, same file/command) is silently approved from then on, persisted to `~/.universal-mcp-fs/always-allow.json`
- **Decline/cancel** — the action is aborted, nothing happens

If you don't respond within 2 minutes, the request automatically resolves to denied — it will not hang the connection or leave Claude waiting indefinitely.

Sensitive paths (`.ssh`, `.aws`, `.gnupg`, browser credential files, `/etc/shadow`) are rejected before any approval prompt is offered — no amount of clicking "allow" gets past this list. You can extend it via `config/default.json` if you build from source.

Every decision (approved, declined, always-allow, timed out, blocked) is logged to `~/.universal-mcp-fs/audit.log` and to stderr, visible in Claude Desktop's MCP server logs.

---

## Security model

- No network transport — this server never opens a port or listens for external connections.
- All file operations are validated against `--allowed-dirs`; anything outside is rejected regardless of approval.
- Symlinks are resolved before validation, so a symlink inside an allowed directory can't be used to escape it.
- Path traversal (`../..`) is normalized away before any check runs.
- If the connected client doesn't support elicitation, dangerous tools fail closed (denied), never fail open.

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
