import { Tool, ToolResult } from "../types.js";
import * as fs from "fs/promises";
import * as path from "path";

export const fileReadTool: Tool = {
  name: "file_read",
  description: "Read the contents of a file. Returns the text content.",
  category: "filesystem",
  builtin: true,
  parameters: [
    { name: "path", type: "string", description: "Absolute or relative path to the file", required: true },
    { name: "encoding", type: "string", description: "File encoding (default: utf-8)", required: false, default: "utf-8" },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      const filePath = path.resolve(params.path);
      const content = await fs.readFile(filePath, { encoding: (params.encoding || "utf-8") as BufferEncoding });
      return { success: true, data: content };
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
