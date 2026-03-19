import { Tool, ToolResult } from "../types.js";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const isWindows = process.platform === "win32";

// Cross-platform shell setup
function getShellOptions(cwd?: string, timeout?: number) {
  const opts: any = {
    cwd: cwd || process.cwd(),
    timeout: timeout || 60000,
    maxBuffer: 1024 * 1024 * 10, // 10MB
    shell: true, // Use default system shell (cmd on Windows, bash on Unix)
  };

  return opts;
}

export const bashExecuteTool: Tool = {
  name: "bash_execute",
  description: `Execute a shell command and return stdout/stderr. Platform: ${isWindows ? "Windows (cmd.exe)" : process.platform + " (bash)"}. Use cross-platform commands when possible (node, npm, npx, git). Avoid platform-specific commands.`,
  category: "system",
  builtin: true,
  parameters: [
    { name: "command", type: "string", description: "Shell command to execute. Prefer cross-platform: node, npm, npx, git. Avoid OS-specific commands.", required: true },
    { name: "cwd", type: "string", description: "Working directory (default: current)", required: false },
    { name: "timeout", type: "number", description: "Timeout in ms (default: 60000)", required: false, default: 60000 },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      const opts = getShellOptions(params.cwd, params.timeout);
      const { stdout, stderr } = await execAsync(params.command, opts);

      return {
        success: true,
        data: {
          stdout: String(stdout).trim(),
          stderr: String(stderr).trim(),
        },
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message?.slice(0, 1000),
        data: {
          stdout: err.stdout?.trim()?.slice(0, 4000) || "",
          stderr: err.stderr?.trim()?.slice(0, 4000) || "",
          code: err.code,
        },
      };
    }
  },
  tests: [
    {
      name: "node version test",
      input: { command: "node --version" },
      validate: (r) => r.success && r.data.stdout.startsWith("v"),
    },
  ],
};
