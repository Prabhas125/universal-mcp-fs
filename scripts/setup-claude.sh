#!/usr/bin/env bash
# setup-claude.sh — auto-configure Claude Desktop for universal-mcp-fs
# Works on both Linux and macOS. Run after `npm install -g universal-mcp-fs`.

set -euo pipefail

# --- Detect the correct config path ---
if [[ "$OSTYPE" == "darwin"* ]]; then
  CONFIG_DIR="$HOME/Library/Application Support/Claude"
else
  CONFIG_DIR="$HOME/.config/Claude"
fi

CONFIG_PATH="$CONFIG_DIR/claude_desktop_config.json"

mkdir -p "$CONFIG_DIR"

if [ ! -f "$CONFIG_PATH" ]; then
  echo '{}' > "$CONFIG_PATH"
else
  # Create a backup before modifying
  TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
  cp "$CONFIG_PATH" "${CONFIG_PATH}.backup-${TIMESTAMP}"
  echo "Backup created: ${CONFIG_PATH}.backup-${TIMESTAMP}"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is not on PATH. Install Node.js >= 20 first." >&2
  exit 1
fi

ALLOWED_DIRS="$HOME"

# Use node itself to safely merge JSON rather than sed/jq assumptions.
node --input-type=module -e "
import fs from 'node:fs';
const configPath = '$CONFIG_PATH';
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
config.mcpServers = config.mcpServers || {};
config.mcpServers.filesystem = {
  command: 'universal-mcp-fs',
  args: ['--allowed-dirs', '$ALLOWED_DIRS']
};
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
console.log('Added filesystem MCP server entry to ' + configPath);
"

echo ""
echo "Allowed directory: $ALLOWED_DIRS (edit the config file to add more, separated by semicolons)"
echo ""
echo "Next steps:"
echo "  1. Fully quit Claude Desktop (don't just close the window)"
echo "  2. Reopen Claude Desktop"
echo "  3. Start a new conversation and ask Claude to list files"
