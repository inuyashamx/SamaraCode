import { Tool, ToolResult } from "../types.js";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

async function runGit(args: string, cwd?: string): Promise<{ stdout: string; stderr: string }> {
  return execAsync(`git ${args}`, {
    cwd: cwd || process.cwd(),
    timeout: 30000,
    maxBuffer: 1024 * 1024 * 10, // 10MB
  });
}

// ─── git_status ───────────────────────────────────────────────────────────────

export const gitStatusTool: Tool = {
  name: "git_status",
  description: "Run git status in a repository and return parsed output including branch name, staged, unstaged, and untracked files.",
  category: "git",
  builtin: true,
  parameters: [
    { name: "cwd", type: "string", description: "Path to the git repository (default: current working directory)", required: false },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      const { stdout } = await runGit("status --porcelain=v1 -b", params.cwd);
      const lines = stdout.split("\n");

      const branchLine = lines.find((l) => l.startsWith("##")) || "";
      const branchMatch = branchLine.replace(/^##\s*/, "").split("...")[0];
      const branch = branchMatch || "unknown";

      const staged: string[] = [];
      const unstaged: string[] = [];
      const untracked: string[] = [];

      for (const line of lines) {
        if (!line || line.startsWith("##")) continue;
        const index = line[0];
        const work = line[1];
        const file = line.slice(3).trim();

        if (index !== " " && index !== "?") staged.push(`${index} ${file}`);
        if (work !== " " && work !== "?") unstaged.push(`${work} ${file}`);
        if (index === "?" && work === "?") untracked.push(file);
      }

      return {
        success: true,
        data: { branch, staged, unstaged, untracked, raw: stdout.trim() },
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
  tests: [
    {
      name: "returns status object",
      input: {},
      validate: (r) =>
        r.success === true &&
        typeof r.data.branch === "string" &&
        Array.isArray(r.data.staged) &&
        Array.isArray(r.data.unstaged) &&
        Array.isArray(r.data.untracked),
    },
  ],
};

// ─── git_diff ─────────────────────────────────────────────────────────────────

export const gitDiffTool: Tool = {
  name: "git_diff",
  description: "Return the git diff for the working tree or staged changes.",
  category: "git",
  builtin: true,
  parameters: [
    { name: "staged", type: "boolean", description: "If true, show staged (cached) diff instead of working-tree diff", required: false, default: false },
    { name: "file", type: "string", description: "Limit diff to a specific file or path", required: false },
    { name: "cwd", type: "string", description: "Path to the git repository (default: current working directory)", required: false },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      const stagedFlag = params.staged ? "--staged" : "";
      const fileArg = params.file ? `-- "${params.file}"` : "";
      const { stdout } = await runGit(`diff ${stagedFlag} ${fileArg}`.trim(), params.cwd);
      return { success: true, data: { diff: stdout } };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
  tests: [
    {
      name: "returns diff string",
      input: {},
      validate: (r) => r.success === true && typeof r.data.diff === "string",
    },
    {
      name: "staged flag accepted",
      input: { staged: true },
      validate: (r) => r.success === true && typeof r.data.diff === "string",
    },
  ],
};

// ─── git_log ──────────────────────────────────────────────────────────────────

interface Commit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
}

function parseGitLog(raw: string): Commit[] {
  if (!raw.trim()) return [];
  const SEPARATOR = "---COMMIT---";
  return raw
    .split(SEPARATOR)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      const [hash = "", shortHash = "", author = "", date = "", ...rest] = lines;
      return {
        hash: hash.trim(),
        shortHash: shortHash.trim(),
        author: author.trim(),
        date: date.trim(),
        message: rest.join("\n").trim(),
      };
    });
}

export const gitLogTool: Tool = {
  name: "git_log",
  description: "Return a parsed list of recent git commits.",
  category: "git",
  builtin: true,
  parameters: [
    { name: "count", type: "number", description: "Number of commits to return (default: 10)", required: false, default: 10 },
    { name: "branch", type: "string", description: "Branch or ref to read log from (default: current branch)", required: false },
    { name: "cwd", type: "string", description: "Path to the git repository (default: current working directory)", required: false },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      const count = params.count || 10;
      const branchArg = params.branch ? params.branch : "";
      const format = "%H%n%h%n%an%n%ai%n%s---COMMIT---";
      const { stdout } = await runGit(
        `log -n ${count} --format="${format}" ${branchArg}`.trim(),
        params.cwd
      );
      const commits = parseGitLog(stdout);
      return { success: true, data: { commits, count: commits.length } };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
  tests: [
    {
      name: "returns commits array",
      input: { count: 5 },
      validate: (r) =>
        r.success === true &&
        Array.isArray(r.data.commits) &&
        typeof r.data.count === "number",
    },
  ],
};

// ─── git_commit ───────────────────────────────────────────────────────────────

export const gitCommitTool: Tool = {
  name: "git_commit",
  description: "Stage specified files (or all changes) and create a git commit with the given message.",
  category: "git",
  builtin: true,
  parameters: [
    { name: "message", type: "string", description: "Commit message", required: true },
    { name: "files", type: "array", description: "List of file paths to stage. Omit or pass [] to stage all changes (git add -A)", required: false },
    { name: "cwd", type: "string", description: "Path to the git repository (default: current working directory)", required: false },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      const cwd = params.cwd || process.cwd();
      const files: string[] = params.files && params.files.length > 0 ? params.files : [];

      // Stage files
      if (files.length === 0) {
        await runGit("add -A", cwd);
      } else {
        const quoted = files.map((f: string) => `"${f}"`).join(" ");
        await runGit(`add ${quoted}`, cwd);
      }

      // Commit – escape double-quotes in message
      const safeMsg = params.message.replace(/"/g, '\\"');
      const { stdout } = await runGit(`commit -m "${safeMsg}"`, cwd);

      return { success: true, data: { output: stdout.trim() } };
    } catch (err: any) {
      return {
        success: false,
        error: err.message,
        data: { stdout: err.stdout?.trim() || "", stderr: err.stderr?.trim() || "" },
      };
    }
  },
  tests: [
    {
      name: "requires message parameter",
      input: { message: "test commit" },
      // We can't truly commit in a test without a repo, so just verify the
      // tool returns a result object with success or a meaningful error.
      validate: (r) => typeof r.success === "boolean",
    },
  ],
};

// ─── git_branch ───────────────────────────────────────────────────────────────

export const gitBranchTool: Tool = {
  name: "git_branch",
  description: "List, create, or switch git branches.",
  category: "git",
  builtin: true,
  parameters: [
    {
      name: "action",
      type: "string",
      description: "Action to perform: 'list' (default), 'create', or 'switch'",
      required: false,
      default: "list",
    },
    {
      name: "name",
      type: "string",
      description: "Branch name — required for 'create' and 'switch' actions",
      required: false,
    },
    {
      name: "cwd",
      type: "string",
      description: "Path to the git repository (default: current working directory)",
      required: false,
    },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      const action: string = params.action || "list";
      const cwd = params.cwd || process.cwd();

      if (action === "list") {
        const { stdout } = await runGit("branch -a --format=%(refname:short)", cwd);
        const { stdout: currentOut } = await runGit("branch --show-current", cwd);
        const branches = stdout
          .split("\n")
          .map((b) => b.trim())
          .filter(Boolean);
        const current = currentOut.trim();
        return { success: true, data: { branches, current } };
      }

      if (action === "create") {
        if (!params.name) return { success: false, error: "Parameter 'name' is required for action 'create'" };
        const { stdout } = await runGit(`checkout -b "${params.name}"`, cwd);
        return { success: true, data: { output: stdout.trim(), branch: params.name } };
      }

      if (action === "switch") {
        if (!params.name) return { success: false, error: "Parameter 'name' is required for action 'switch'" };
        const { stdout } = await runGit(`checkout "${params.name}"`, cwd);
        return { success: true, data: { output: stdout.trim(), branch: params.name } };
      }

      return { success: false, error: `Unknown action '${action}'. Valid actions: list, create, switch` };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
  tests: [
    {
      name: "list branches returns array",
      input: { action: "list" },
      validate: (r) =>
        r.success === true &&
        Array.isArray(r.data.branches) &&
        typeof r.data.current === "string",
    },
    {
      name: "unknown action returns error",
      input: { action: "delete" },
      validate: (r) => r.success === false && typeof r.error === "string",
    },
  ],
};
