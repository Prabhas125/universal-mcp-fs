# setup-claude.ps1 — auto-configure Claude Desktop for universal-mcp-fs on Windows
# Run this after `npm install -g universal-mcp-fs`.

$ErrorActionPreference = "Stop"

# --- Detect the correct config path ---
# Standard Windows path
$configDir = Join-Path $env:APPDATA "Claude"
$configPath = Join-Path $configDir "claude_desktop_config.json"

# Check for Windows Store (UWP) sandboxed Claude installation.
# UWP apps have their AppData redirected to %LOCALAPPDATA%\Packages\<package>\LocalCache
$uwpBase = Join-Path $env:LOCALAPPDATA "Packages"
if (Test-Path $uwpBase) {
    $uwpMatch = Get-ChildItem -Path $uwpBase -Filter "Claude_*" -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($uwpMatch) {
        $uwpConfigPath = Join-Path $uwpMatch.FullName "LocalCache\Roaming\Claude\claude_desktop_config.json"
        # Prefer the UWP path if it exists (the standard path is ignored by Store installs)
        if (Test-Path $uwpConfigPath) {
            $configPath = $uwpConfigPath
            $configDir = Split-Path $configPath
            Write-Host "Detected Windows Store (UWP) Claude installation: $($uwpMatch.Name)"
        } elseif (-not (Test-Path $configPath)) {
            # Neither exists — use UWP path if Claude dir exists under the package
            $uwpClaudeDir = Join-Path $uwpMatch.FullName "LocalCache\Roaming\Claude"
            if (Test-Path $uwpClaudeDir) {
                $configPath = $uwpConfigPath
                $configDir = $uwpClaudeDir
                Write-Host "Detected Windows Store (UWP) Claude installation: $($uwpMatch.Name)"
            }
        }
    }
}

# --- Ensure config directory and file exist ---
if (-not (Test-Path $configDir)) {
    New-Item -ItemType Directory -Path $configDir -Force | Out-Null
}

if (Test-Path $configPath) {
    # Create a backup before modifying
    $timestamp = (Get-Date -Format "yyyy-MM-dd_HH-mm-ss")
    $backupPath = "$configPath.backup-$timestamp"
    Copy-Item -Path $configPath -Destination $backupPath
    Write-Host "Backup created: $backupPath"
    $config = Get-Content $configPath -Raw | ConvertFrom-Json
} else {
    $config = [PSCustomObject]@{}
}

if (-not $config.PSObject.Properties["mcpServers"]) {
    $config | Add-Member -NotePropertyName "mcpServers" -NotePropertyValue ([PSCustomObject]@{})
}

$allowedDirs = "$env:USERPROFILE"

$entry = [PSCustomObject]@{
    command = "universal-mcp-fs"
    args    = @("--allowed-dirs", $allowedDirs)
}

$config.mcpServers | Add-Member -NotePropertyName "filesystem" -NotePropertyValue $entry -Force

$config | ConvertTo-Json -Depth 10 | Set-Content -Path $configPath -Encoding UTF8

Write-Host ""
Write-Host "Added 'filesystem' MCP server entry to $configPath"
Write-Host "Allowed directory: $allowedDirs (edit the config file to add more, separated by semicolons)"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Fully quit Claude Desktop (don't just close the window)"
Write-Host "  2. Reopen Claude Desktop"
Write-Host "  3. Start a new conversation and ask Claude to list files"
