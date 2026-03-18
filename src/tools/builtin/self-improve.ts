import { Tool, ToolResult } from "../types.js";
import * as fs from "fs/promises";
import * as path from "path";

// Resolve SamaraCode's own source directory
function getSamaraCodeSrcDir(): string {
  // This file is at src/tools/builtin/self-improve.ts → src is 2 levels up
  return path.resolve(new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"), "..", "..", "..");
}

export const selfReadTool: Tool = {
  name: "self_read",
  description: "Read SamaraCode's own source code. Use this to understand how the agent works before proposing changes.",
  category: "self",
  builtin: true,
  parameters: [
    { name: "file", type: "string", description: "Relative path within SamaraCode source (e.g. 'src/core/orchestrator.ts')", required: true },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      const srcDir = getSamaraCodeSrcDir();
      const filePath = path.resolve(srcDir, params.file);

      // Safety: only allow reading within the SamaraCode project
      if (!filePath.startsWith(srcDir)) {
        return { success: false, error: "Cannot read files outside SamaraCode source directory." };
      }

      const content = await fs.readFile(filePath, "utf-8");
      return {
        success: true,
        data: {
          file: params.file,
          content,
          lines: content.split("\n").length,
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
  tests: [
    {
      name: "read own package.json",
      input: { file: "package.json" },
      validate: (r) => r.success && r.data.content.includes("samaracode"),
    },
  ],
};

export const selfListTool: Tool = {
  name: "self_list",
  description: "List SamaraCode's own source files. Use to explore the agent's codebase before making changes.",
  category: "self",
  builtin: true,
  parameters: [
    { name: "dir", type: "string", description: "Relative directory within SamaraCode source (default: 'src')", required: false },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      const srcDir = getSamaraCodeSrcDir();
      const targetDir = path.resolve(srcDir, params.dir || "src");

      if (!targetDir.startsWith(srcDir)) {
        return { success: false, error: "Cannot list files outside SamaraCode source directory." };
      }

      const result: string[] = [];
      async function walk(dir: string, prefix: string) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            await walk(path.join(dir, entry.name), rel);
          } else {
            result.push(rel);
          }
        }
      }
      await walk(targetDir, "");

      return { success: true, data: { files: result, count: result.length } };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
  tests: [
    {
      name: "list src dir",
      input: { dir: "src" },
      validate: (r) => r.success && r.data.count > 0,
    },
  ],
};

// This is the proposal tool — it does NOT write code.
// It creates a proposal that must be reviewed and confirmed separately.
export const selfProposeTool: Tool = {
  name: "self_propose",
  description: `Propose a modification to SamaraCode's own source code. This does NOT execute the change — it creates a proposal that the user must review and approve. Always use self_read first to understand the current code. The proposal must include: what you're changing, why, and the exact code diff.`,
  category: "self",
  builtin: true,
  parameters: [
    { name: "file", type: "string", description: "Relative path to the file to modify (e.g. 'src/tools/builtin/index.ts')", required: true },
    { name: "description", type: "string", description: "What this change does and why it's needed", required: true },
    { name: "old_code", type: "string", description: "The exact existing code block to replace (must match exactly)", required: true },
    { name: "new_code", type: "string", description: "The new code to replace it with", required: true },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      const srcDir = getSamaraCodeSrcDir();
      const filePath = path.resolve(srcDir, params.file);

      if (!filePath.startsWith(srcDir)) {
        return { success: false, error: "Cannot modify files outside SamaraCode source directory." };
      }

      // Read current file to verify old_code exists
      const content = await fs.readFile(filePath, "utf-8");
      if (!content.includes(params.old_code)) {
        return {
          success: false,
          error: "old_code not found in file. Use self_read to get the exact current content.",
        };
      }

      // Count occurrences — must be exactly 1
      const occurrences = content.split(params.old_code).length - 1;
      if (occurrences > 1) {
        return {
          success: false,
          error: `old_code found ${occurrences} times. Provide a more unique code block.`,
        };
      }

      // Store proposal — do NOT apply yet
      const proposal = {
        id: `prop_${Date.now()}`,
        file: params.file,
        filePath,
        description: params.description,
        old_code: params.old_code,
        new_code: params.new_code,
        createdAt: new Date().toISOString(),
      };

      // Save proposal to a temp file for the confirmation step
      const proposalDir = path.join(srcDir, "data", "proposals");
      await fs.mkdir(proposalDir, { recursive: true });
      await fs.writeFile(
        path.join(proposalDir, `${proposal.id}.json`),
        JSON.stringify(proposal, null, 2)
      );

      return {
        success: true,
        data: {
          proposalId: proposal.id,
          message: `Proposal created. The user must review and approve with self_apply.`,
          summary: {
            file: params.file,
            description: params.description,
            linesRemoved: params.old_code.split("\n").length,
            linesAdded: params.new_code.split("\n").length,
          },
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
  tests: [],
};

export const selfApplyTool: Tool = {
  name: "self_apply",
  description: "Apply a previously proposed self-modification. ALWAYS requires user confirmation — this cannot be auto-accepted.",
  category: "self",
  builtin: true,
  parameters: [
    { name: "proposal_id", type: "string", description: "The proposal ID to apply", required: true },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      const srcDir = getSamaraCodeSrcDir();
      const proposalPath = path.join(srcDir, "data", "proposals", `${params.proposal_id}.json`);

      let proposal: any;
      try {
        proposal = JSON.parse(await fs.readFile(proposalPath, "utf-8"));
      } catch {
        return { success: false, error: `Proposal "${params.proposal_id}" not found.` };
      }

      // Read file and apply
      const content = await fs.readFile(proposal.filePath, "utf-8");

      if (!content.includes(proposal.old_code)) {
        return { success: false, error: "Code has changed since proposal was created. Create a new proposal." };
      }

      const newContent = content.replace(proposal.old_code, proposal.new_code);
      await fs.writeFile(proposal.filePath, newContent, "utf-8");

      // Clean up proposal
      await fs.unlink(proposalPath).catch(() => {});

      return {
        success: true,
        data: {
          message: `Applied: ${proposal.description}`,
          file: proposal.file,
          note: "Restart SamaraCode to load the changes.",
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
  tests: [],
};
