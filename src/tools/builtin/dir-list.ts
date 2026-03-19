import { Tool, ToolResult } from "../types.js";
import * as fs from "fs/promises";
import * as path from "path";

export const dirListTool: Tool = {
  name: "dir_list",
  description: "List files and directories in a path. Returns names with type indicators.",
  category: "filesystem",
  builtin: true,
  parameters: [
    { name: "path", type: "string", description: "Directory path to list", required: true },
    { name: "recursive", type: "boolean", description: "List recursively (default: false)", required: false, default: false },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      const dirPath = path.resolve(params.path);
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      const items = entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "directory" : "file",
      }));

      if (params.recursive) {
        const result: any[] = [];
        async function walk(dir: string, prefix: string) {
          const ents = await fs.readdir(dir, { withFileTypes: true });
          for (const ent of ents) {
            const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
            result.push({ name: rel, type: ent.isDirectory() ? "directory" : "file" });
            if (ent.isDirectory() && !ent.name.startsWith(".") && ent.name !== "node_modules" && ent.name !== "bower_components" && ent.name !== "dist" && ent.name !== "build" && ent.name !== "vendor") {
              await walk(path.join(dir, ent.name), rel);
            }
          }
        }
        await walk(dirPath, "");
        return { success: true, data: result };
      }

      return { success: true, data: items };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
  tests: [
    {
      name: "list current dir",
      input: { path: "." },
      validate: (r) => r.success && Array.isArray(r.data) && r.data.length > 0,
    },
  ],
};
