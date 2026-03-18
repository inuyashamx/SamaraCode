import { Tool, ToolResult } from "../types.js";
import * as fs from "fs/promises";
import * as path from "path";

export const grepSearchTool: Tool = {
  name: "grep_search",
  description: "Search for a pattern in files. Supports regex. Returns matching lines with file paths and line numbers.",
  category: "filesystem",
  builtin: true,
  parameters: [
    { name: "pattern", type: "string", description: "Regex pattern to search for", required: true },
    { name: "path", type: "string", description: "Directory or file to search in (default: current dir)", required: false, default: "." },
    { name: "include", type: "string", description: "File glob pattern to include (e.g. '*.ts')", required: false },
    { name: "max_results", type: "number", description: "Max matching lines (default: 50)", required: false, default: 50 },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      const searchPath = path.resolve(params.path || ".");
      const regex = new RegExp(params.pattern, "gi");
      const maxResults = params.max_results || 50;
      const includePattern = params.include ? new RegExp(params.include.replace(/\*/g, ".*").replace(/\./g, "\\.")) : null;

      const matches: { file: string; line: number; content: string }[] = [];

      async function searchFile(filePath: string) {
        if (matches.length >= maxResults) return;
        try {
          const content = await fs.readFile(filePath, "utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
            if (regex.test(lines[i])) {
              matches.push({
                file: path.relative(process.cwd(), filePath),
                line: i + 1,
                content: lines[i].trim(),
              });
              regex.lastIndex = 0; // Reset regex state
            }
          }
        } catch {
          // Skip files that can't be read
        }
      }

      async function walkDir(dir: string) {
        if (matches.length >= maxResults) return;
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (matches.length >= maxResults) return;
          if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walkDir(fullPath);
          } else if (entry.isFile()) {
            if (includePattern && !includePattern.test(entry.name)) continue;
            await searchFile(fullPath);
          }
        }
      }

      const stat = await fs.stat(searchPath);
      if (stat.isFile()) {
        await searchFile(searchPath);
      } else {
        await walkDir(searchPath);
      }

      return {
        success: true,
        data: { matches, count: matches.length, truncated: matches.length >= maxResults },
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
  tests: [
    {
      name: "search for import in ts files",
      input: { pattern: "import", path: "src", include: "*.ts" },
      validate: (r) => r.success,
    },
  ],
};
