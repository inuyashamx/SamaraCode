import { Tool, ToolResult } from "../types.js";
import * as fs from "fs/promises";
import * as path from "path";

// File-level locks to prevent concurrent writes to the same file
const fileLocks = new Map<string, Promise<void>>();

async function withFileLock(filePath: string, fn: () => Promise<ToolResult>): Promise<ToolResult> {
  const key = path.resolve(filePath);
  // Wait for any existing lock on this file
  while (fileLocks.has(key)) {
    await fileLocks.get(key);
  }
  // Create our lock
  let unlock: () => void;
  const lock = new Promise<void>((resolve) => { unlock = resolve; });
  fileLocks.set(key, lock);
  try {
    return await fn();
  } finally {
    fileLocks.delete(key);
    unlock!();
  }
}

export const fileWriteTool: Tool = {
  name: "file_write",
  description: "Write content to a file. Creates directories if needed. Overwrites existing files. Safe for concurrent use — file-level locking prevents agents from overwriting each other.",
  category: "filesystem",
  builtin: true,
  parameters: [
    { name: "path", type: "string", description: "Path to the file to write", required: true },
    { name: "content", type: "string", description: "Content to write to the file", required: true },
    { name: "append", type: "boolean", description: "Append instead of overwrite (default: false)", required: false, default: false },
  ],
  async execute(params): Promise<ToolResult> {
    return withFileLock(params.path, async () => {
      try {
        const filePath = path.resolve(params.path);
        await fs.mkdir(path.dirname(filePath), { recursive: true });

        if (params.append) {
          await fs.appendFile(filePath, params.content, "utf-8");
        } else {
          await fs.writeFile(filePath, params.content, "utf-8");
        }

        return { success: true, data: `Written to ${filePath}` };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });
  },
  tests: [
    {
      name: "write and verify",
      input: { path: "/tmp/samaracode-test-write.txt", content: "hello samaracode" },
      validate: (r) => r.success === true,
    },
  ],
};
