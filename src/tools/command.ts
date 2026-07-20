import { execFile, spawn, type ChildProcess } from "node:child_process";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerConfig } from "../types/index.js";
import type { PermissionManager, ElicitationCapableServer } from "../security/permissions.js";
import { getShell } from "../utils/platform.js";
import type { BackgroundProcess } from "../types/index.js";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// In-memory registry of background processes started by this server
// instance. Cleared on restart — Claude Desktop's kill/respawn cycle
// naturally terminates any child processes anyway (they are not detached
// from the OS process tree in a way that survives a full reboot).
const backgroundProcesses = new Map<number, { info: BackgroundProcess; handle: ChildProcess }>();

export function registerCommandTools(
  server: McpServer,
  config: ServerConfig,
  permissions: PermissionManager,
  getLowLevelServer: () => ElicitationCapableServer
): void {
  // ---- run_command ----
  server.registerTool(
    "run_command",
    {
      title: "Run Shell Command",
      description: `Execute a shell command and return its stdout/stderr. ALWAYS requires interactive user approval before running.

Args:
  - command (string): The command to execute (interpreted by the platform shell — cmd.exe on Windows, bash on Linux).
  - cwd (string, optional): Working directory. Defaults to the first allowed directory.
  - timeout (number, optional): Timeout in milliseconds. Default: 30000, max 300000.

Returns: stdout, stderr, and exit code.

Error Handling:
  - Returns an error if the user declines the approval prompt.
  - Returns an error if the command exceeds the timeout (process is killed).`,
      inputSchema: {
        command: z.string().min(1).describe("Shell command to execute"),
        cwd: z.string().optional().describe("Working directory for the command"),
        timeout: z.number().int().min(1000).max(300000).optional().describe("Timeout in milliseconds"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ command, cwd, timeout }) => {
      try {
        if (!config.enableCommands) {
          return { content: [{ type: "text" as const, text: "Error: command execution is disabled on this server (enableCommands=false)." }], isError: true };
        }

        await permissions.requestPermission(
          getLowLevelServer(),
          "run_command",
          `Execute command: ${command}`,
          { command, cwd: cwd ?? config.allowedDirs[0] }
        );

        const shell = getShell();
        const effectiveTimeout = Math.min(timeout ?? config.commandTimeoutMs, 300000);

        const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
          execFile(
            shell.cmd,
            [...shell.args, command],
            { cwd: cwd ?? config.allowedDirs[0], timeout: effectiveTimeout, maxBuffer: 10 * 1024 * 1024 },
            (error, stdout, stderr) => {
              const code = (error as { code?: number } | null)?.code ?? 0;
              resolve({ stdout, stderr, code });
            }
          );
        });

        const text = `Exit code: ${result.code}\n\n--- stdout ---\n${result.stdout || "(empty)"}\n\n--- stderr ---\n${result.stderr || "(empty)"}`;
        return { content: [{ type: "text" as const, text }], isError: result.code !== 0 };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${errorMessage(err)}` }], isError: true };
      }
    }
  );

  // ---- run_command_background ----
  server.registerTool(
    "run_command_background",
    {
      title: "Run Command in Background",
      description: `Start a long-running command in the background and return immediately with its process ID. ALWAYS requires interactive user approval before running.

Args:
  - command (string): The command to execute.
  - cwd (string, optional): Working directory. Defaults to the first allowed directory.

Returns: the process ID (pid), which can be used with list_processes and kill_process.

Note: background processes have no timeout, but they are tracked and can be killed with kill_process. They do not survive this server process restarting (e.g. Claude Desktop being closed and reopened).`,
      inputSchema: {
        command: z.string().min(1).describe("Shell command to execute in the background"),
        cwd: z.string().optional().describe("Working directory for the command"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ command, cwd }) => {
      try {
        if (!config.enableCommands) {
          return { content: [{ type: "text" as const, text: "Error: command execution is disabled on this server (enableCommands=false)." }], isError: true };
        }

        await permissions.requestPermission(
          getLowLevelServer(),
          "run_command_background",
          `Start background command: ${command}`,
          { command, cwd: cwd ?? config.allowedDirs[0] }
        );

        const shell = getShell();
        const effectiveCwd = cwd ?? config.allowedDirs[0];
        const child = spawn(shell.cmd, [...shell.args, command], {
          cwd: effectiveCwd,
          detached: true,
          stdio: "ignore",
        });
        child.unref();

        if (!child.pid) {
          return { content: [{ type: "text" as const, text: "Error: failed to start background process (no PID assigned)." }], isError: true };
        }

        const info: BackgroundProcess = {
          pid: child.pid,
          command,
          cwd: effectiveCwd,
          startedAt: new Date().toISOString(),
          status: "running",
        };
        backgroundProcesses.set(child.pid, { info, handle: child });

        child.on("exit", (code) => {
          const entry = backgroundProcesses.get(child.pid!);
          if (entry) {
            entry.info.status = "exited";
            entry.info.exitCode = code;
          }
        });

        return { content: [{ type: "text" as const, text: `Started background process with PID ${child.pid}: ${command}` }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${errorMessage(err)}` }], isError: true };
      }
    }
  );

  // ---- list_processes ----
  server.registerTool(
    "list_processes",
    {
      title: "List Background Processes",
      description: `List background processes started via run_command_background during this session, with their status.

Returns: a list of tracked processes with PID, command, status, and start time.`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const entries = Array.from(backgroundProcesses.values()).map((e) => e.info);
      if (entries.length === 0) {
        return { content: [{ type: "text" as const, text: "No background processes tracked in this session." }] };
      }
      const lines = entries.map(
        (p) =>
          `PID ${p.pid} [${p.status}${p.exitCode !== undefined && p.exitCode !== null ? `, exit code ${p.exitCode}` : ""}] started ${p.startedAt}: ${p.command}`
      );
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  // ---- kill_process ----
  server.registerTool(
    "kill_process",
    {
      title: "Kill Background Process",
      description: `Terminate a background process previously started with run_command_background. Requires interactive user approval before proceeding.

Args:
  - pid (number): Process ID to kill (must be one tracked by this server — see list_processes).`,
      inputSchema: { pid: z.number().int().positive().describe("Process ID to terminate") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ pid }) => {
      try {
        const entry = backgroundProcesses.get(pid);
        if (!entry) {
          return { content: [{ type: "text" as const, text: `Error: PID ${pid} is not a process tracked by this server (see list_processes).` }], isError: true };
        }

        await permissions.requestPermission(
          getLowLevelServer(),
          "kill_process",
          `Kill process PID ${pid}: ${entry.info.command}`,
          { pid: String(pid), command: entry.info.command }
        );

        process.kill(pid);
        entry.info.status = "killed";
        return { content: [{ type: "text" as const, text: `Killed process PID ${pid}` }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${errorMessage(err)}` }], isError: true };
      }
    }
  );
}
