import { Tool, ToolResult } from "../types.js";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

const MEMORY_DIR = path.join(os.homedir(), ".samaracode", "memory");

export const memorySaveTool: Tool = {
  name: "memory_save",
  description: "Save a piece of information to persistent memory. Use for things the agent needs to remember across sessions.",
  category: "memory",
  builtin: true,
  parameters: [
    { name: "key", type: "string", description: "A unique key/name for this memory", required: true },
    { name: "content", type: "string", description: "The content to remember", required: true },
    { name: "tags", type: "array", description: "Tags for categorization", required: false },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      await fs.mkdir(MEMORY_DIR, { recursive: true });
      const entry = {
        key: params.key,
        content: params.content,
        tags: params.tags || [],
        savedAt: new Date().toISOString(),
      };
      const filePath = path.join(MEMORY_DIR, `${params.key}.json`);
      await fs.writeFile(filePath, JSON.stringify(entry, null, 2));
      return { success: true, data: `Memory saved: ${params.key}` };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
};

export const memoryLoadTool: Tool = {
  name: "memory_load",
  description: "Load a specific memory by key, or list all memories if no key provided.",
  category: "memory",
  builtin: true,
  parameters: [
    { name: "key", type: "string", description: "Key of the memory to load (omit to list all)", required: false },
    { name: "tag", type: "string", description: "Filter memories by tag", required: false },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      await fs.mkdir(MEMORY_DIR, { recursive: true });

      if (params.key) {
        const filePath = path.join(MEMORY_DIR, `${params.key}.json`);
        const data = JSON.parse(await fs.readFile(filePath, "utf-8"));
        return { success: true, data };
      }

      // List all memories
      const files = await fs.readdir(MEMORY_DIR);
      const memories = [];
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const data = JSON.parse(await fs.readFile(path.join(MEMORY_DIR, file), "utf-8"));
        if (params.tag && !data.tags?.includes(params.tag)) continue;
        memories.push({ key: data.key, tags: data.tags, savedAt: data.savedAt, preview: data.content.slice(0, 100) });
      }
      return { success: true, data: memories };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
};
