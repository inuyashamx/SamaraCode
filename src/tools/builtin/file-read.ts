import { Tool, ToolResult } from "../types.js";
import * as fs from "fs/promises";
import * as path from "path";

const MAX_LINES_DEFAULT = 300;

export const fileReadTool: Tool = {
  name: "file_read",
  description: "Read the contents of a file. Use start_line/end_line to read specific sections and save tokens. Files over 300 lines are truncated by default — use max_lines to override.",
  category: "filesystem",
  builtin: true,
  parameters: [
    { name: "path", type: "string", description: "Absolute or relative path to the file", required: true },
    { name: "encoding", type: "string", description: "File encoding (default: utf-8)", required: false, default: "utf-8" },
    { name: "start_line", type: "number", description: "Start reading from this line (1-based). Use with end_line to read specific sections.", required: false },
    { name: "end_line", type: "number", description: "Stop reading at this line (inclusive).", required: false },
    { name: "max_lines", type: "number", description: "Maximum lines to return (default: 300). Set higher if you need the full file.", required: false },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      const filePath = path.resolve(params.path);
      const raw = await fs.readFile(filePath, { encoding: (params.encoding || "utf-8") as BufferEncoding });
      const allLines = raw.split("\n");
      const totalLines = allLines.length;

      let start = 1;
      let end = totalLines;

      if (params.start_line && params.start_line > 0) {
        start = params.start_line;
      }
      if (params.end_line && params.end_line > 0) {
        end = Math.min(params.end_line, totalLines);
      }

      let lines = allLines.slice(start - 1, end);

      // Apply max_lines limit
      const maxLines = params.max_lines || MAX_LINES_DEFAULT;
      let truncated = false;
      if (lines.length > maxLines) {
        lines = lines.slice(0, maxLines);
        truncated = true;
      }

      // Add line numbers for context
      const numbered = lines.map((line, i) => `${start + i}: ${line}`).join("\n");

      const header = `[${filePath} — ${totalLines} lines total, showing ${start}-${start + lines.length - 1}]`;
      const footer = truncated
        ? `\n[... truncated at ${maxLines} lines. Use start_line/end_line to read more, or set max_lines higher.]`
        : "";

      return { success: true, data: `${header}\n${numbered}${footer}` };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
  tests: [
    {
      name: "read package.json",
      input: { path: "package.json" },
      validate: (r) => r.success && typeof r.data === "string" && r.data.includes("samaracode"),
    },
  ],
};
